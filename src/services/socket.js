const { Server } = require('socket.io');
const authMiddleware = require('../middleware/auth');
const UserQueries = require('../db/queries/users');
const MessageQueries = require('../db/queries/messages');

// Import db with correct relative path
const db = require('../config/db');

/** Matches the REST cap in routes/messages.js. The socket had no cap at all. */
const MAX_MESSAGE_LENGTH = 2000;

/**
 * The authenticated wallet for a socket.
 *
 * Read from `socket.data`, not from a custom `socket.user` property, because
 * `connectionStateRecovery` restores `socket.data` and nothing else. Identity
 * stored anywhere but here comes back `undefined` after a recovered reconnect.
 */
function walletOf(socket) {
  return socket.data.user?.walletAddress;
}

class SocketService {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN?.split(',') || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        // Middleware MUST re-run on a recovered connection. With this true,
        // socket.io calls _doConnect directly and the auth middleware below
        // never executes — the connection handler then dereferences an
        // identity that was never set, throws inside an un-awaited promise,
        // and takes the whole process down with an unhandled rejection. On a
        // free tier where instances sleep and clients reconnect on wake, that
        // fires constantly.
        skipMiddlewares: false
      }
    });

    this.io.use((socket, next) => {
      // The token is deliberately not logged. It was, in full, on every
      // connection attempt — anyone with access to the log stream could
      // impersonate any user for the remaining 7 days of that token's life.
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: Token required'));
      }

      try {
        const { verifyToken } = require('../config/jwt');
        socket.data.user = verifyToken(token);
        next();
      } catch (error) {
        return next(new Error('Authentication error: Invalid token'));
      }
    });

    this.initializeHandlers();
  }

  initializeHandlers() {
    this.io.on('connection', async (socket) => {
      // Room membership is always rebuilt from the database, never trusted
      // from the recovered session. Otherwise a user removed from a room
      // during a brief disconnection is silently re-joined on recovery and
      // keeps receiving its messages — including the ones sent after they
      // were removed, which the recovery buffer replays.
      if (socket.recovered) {
        for (const room of socket.rooms) {
          if (room !== socket.id) socket.leave(room);
        }
      }

      await this.joinUserRooms(socket);

      // Message events
      socket.on('send_message', async (data) => {
        await this.handleSendMessage(socket, data);
      });

      socket.on('typing', (data) => {
        this.handleTyping(socket, data);
      });

      socket.on('typing_stop', (data) => {
        this.handleTypingStop(socket, data);
      });

      // Reaction events
      socket.on('like_message', (data) => {
        this.handleLikeMessage(socket, data);
      });

      socket.on('unlike_message', (data) => {
        this.handleUnlikeMessage(socket, data);
      });

      // Room events
      socket.on('join_room', async (data) => {
        await this.handleJoinRoom(socket, data);
      });

      socket.on('leave_room', (data) => {
        this.handleLeaveRoom(socket, data);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  async joinUserRooms(socket) {
    try {
      const userResult = await UserQueries.getUserByWallet(walletOf(socket));
      if (!userResult.rows.length) return;

      const userId = userResult.rows[0].id;
      // Cached for the life of the socket. Every handler used to re-resolve
      // wallet -> id with its own query, so a single message cost three
      // round-trips where one would do.
      socket.data.userId = userId;

      // Get user's approved rooms
      const query = `
        SELECT room_id FROM room_members
        WHERE user_id = $1 AND status = 'approved'
      `;
      const result = await db.query(query, [userId]);

      const rooms = result.rows.map((row) => row.room_id);
      for (const roomId of rooms) socket.join(roomId);

      socket.emit('rooms_joined', {
        rooms,
        count: rooms.length
      });
    } catch (error) {
      console.error('Join user rooms error:', error);
    }
  }

  /**
   * The user's id, resolved once per socket.
   *
   * Falls back to a lookup for the rare case where the connect-time resolution
   * failed (a user row created after the token was issued, say).
   */
  async userId(socket) {
    if (socket.data.userId) return socket.data.userId;
    const result = await UserQueries.getUserByWallet(walletOf(socket));
    if (!result.rows.length) return null;
    socket.data.userId = result.rows[0].id;
    return socket.data.userId;
  }

  /**
   * Whether this socket is genuinely in a room.
   *
   * Socket.io room membership is only ever set from an approved database row
   * — at connect, or by `handleJoinRoom` — so this is an authorization check,
   * not a convenience. It costs nothing, which is why the events that used to
   * skip it now don't.
   */
  inRoom(socket, roomId) {
    return typeof roomId === 'string' && socket.rooms.has(roomId);
  }

  async handleJoinRoom(socket, data) {
    try {
      const { roomId } = data;
      const userId = await this.userId(socket);

      if (!userId) {
        return socket.emit('error', { message: 'User not found' });
      }

      // Check if user is approved member
      const query = `
        SELECT status FROM room_members
        WHERE room_id = $1 AND user_id = $2
      `;
      const result = await db.query(query, [roomId, userId]);

      if (!result.rows.length || result.rows[0].status !== 'approved') {
        return socket.emit('error', { message: 'Not a member of this room' });
      }

      socket.join(roomId);

      // Notify others in room
      socket.to(roomId).emit('user_joined', {
        walletAddress: walletOf(socket),
        timestamp: new Date().toISOString()
      });

      socket.emit('room_joined', {
        roomId,
        success: true
      });
    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  handleLeaveRoom(socket, data) {
    const { roomId } = data;

    // Without this check the server broadcast a `user_left` event carrying the
    // caller's wallet into any room id they cared to name — presence spam into
    // private rooms, and an oracle for probing which room ids exist.
    if (!this.inRoom(socket, roomId)) {
      return socket.emit('error', { message: 'Not a member of this room' });
    }

    socket.leave(roomId);

    // Notify others in room
    socket.to(roomId).emit('user_left', {
      walletAddress: walletOf(socket),
      timestamp: new Date().toISOString()
    });

    socket.emit('room_left', { roomId, success: true });
  }

  async handleSendMessage(socket, data) {
    try {
      const { roomId, content, parentMessageId } = data;

      if (typeof content !== 'string' || content.trim().length === 0) {
        return socket.emit('error', { message: 'Message content required' });
      }

      // The REST route caps content at 2000 characters and this path capped it
      // at nothing, so the limit was one `emit` away from being bypassed. With
      // socket.io's 1 MB default frame size that meant ~1 MB rows, broadcast
      // to every member of the room.
      if (content.length > MAX_MESSAGE_LENGTH) {
        return socket.emit('error', {
          message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`
        });
      }

      const userId = await this.userId(socket);
      if (!userId) {
        return socket.emit('error', { message: 'User not found' });
      }

      // Check if user can send messages in this room
      const canSendQuery = `
        SELECT status FROM room_members 
        WHERE room_id = $1 AND user_id = $2
      `;
      const canSendResult = await db.query(canSendQuery, [roomId, userId]);

      if (!canSendResult.rows.length || canSendResult.rows[0].status !== 'approved') {
        return socket.emit('error', { message: 'Cannot send messages in this room' });
      }

      // Save message to database
      const messageResult = await MessageQueries.createMessage(
        roomId, 
        userId, 
        content.trim(), 
        parentMessageId
      );

      const message = messageResult.rows[0];
      
      // Add sender wallet to message
      const messageWithSender = {
        ...message,
        sender_wallet: walletOf(socket),
        like_count: 0,
        liked_by: []
      };

      // Broadcast to room
      this.io.to(roomId).emit('new_message', messageWithSender);
      
    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  // Both of these took a caller-supplied room id and broadcast into it with no
  // membership check at all, so any authenticated user could inject their
  // wallet address into the typing indicator of any private room.
  handleTyping(socket, data) {
    const { roomId } = data;
    if (!this.inRoom(socket, roomId)) return;

    socket.to(roomId).emit('user_typing', {
      walletAddress: walletOf(socket),
      roomId,
      timestamp: new Date().toISOString()
    });
  }

  handleTypingStop(socket, data) {
    const { roomId } = data;
    if (!this.inRoom(socket, roomId)) return;

    socket.to(roomId).emit('user_typing_stop', {
      walletAddress: walletOf(socket),
      roomId
    });
  }

  async handleLikeMessage(socket, data) {
    try {
      const { messageId, reactionType = 'like' } = data;
      
      const userId = await this.userId(socket);
      if (!userId) {
        return socket.emit('error', { message: 'User not found' });
      }

      // Get message room to check permissions
      const roomQuery = `
        SELECT m.room_id 
        FROM messages m
        JOIN room_members rm ON m.room_id = rm.room_id
        WHERE m.id = $1 AND rm.user_id = $2 AND rm.status = 'approved'
      `;
      const roomResult = await db.query(roomQuery, [messageId, userId]);

      if (!roomResult.rows.length) {
        return socket.emit('error', { message: 'Cannot like this message' });
      }

      const roomId = roomResult.rows[0].room_id;

      // Save like to database
      await MessageQueries.likeMessage(messageId, userId, reactionType);

      // Get updated like count
      const likesResult = await MessageQueries.getMessageLikes(messageId);

      // Broadcast to room
      this.io.to(roomId).emit('message_liked', {
        messageId,
        walletAddress: walletOf(socket),
        reactionType,
        likeCount: likesResult.rows.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Like message error:', error);
      socket.emit('error', { message: 'Failed to like message' });
    }
  }

  async handleUnlikeMessage(socket, data) {
    try {
      const { messageId, reactionType = 'like' } = data;
      
      const userId = await this.userId(socket);
      if (!userId) {
        return socket.emit('error', { message: 'User not found' });
      }

      // Get message room
      const roomQuery = `
        SELECT m.room_id 
        FROM messages m
        JOIN room_members rm ON m.room_id = rm.room_id
        WHERE m.id = $1 AND rm.user_id = $2 AND rm.status = 'approved'
      `;
      const roomResult = await db.query(roomQuery, [messageId, userId]);

      if (!roomResult.rows.length) {
        return socket.emit('error', { message: 'Cannot unlike this message' });
      }

      const roomId = roomResult.rows[0].room_id;

      // Remove like from database
      await MessageQueries.unlikeMessage(messageId, userId, reactionType);

      // Get updated like count
      const likesResult = await MessageQueries.getMessageLikes(messageId);

      // Broadcast to room
      this.io.to(roomId).emit('message_unliked', {
        messageId,
        walletAddress: walletOf(socket),
        reactionType,
        likeCount: likesResult.rows.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Unlike message error:', error);
      socket.emit('error', { message: 'Failed to unlike message' });
    }
  }

  handleDisconnect(socket) {
    console.log(`User disconnected: ${walletOf(socket) ?? 'unknown'}`);
  }

  // Helper method to notify room members
  notifyRoom(roomId, event, data) {
    this.io.to(roomId).emit(event, data);
  }
}

module.exports = SocketService;