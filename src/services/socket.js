const { Server } = require('socket.io');
const authMiddleware = require('../middleware/auth');
const UserQueries = require('../db/queries/users');
const MessageQueries = require('../db/queries/messages');

// Import db with correct relative path
const db = require('../config/db');

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
        skipMiddlewares: true
      }
    });

    // Add debug logging for auth
    this.io.use((socket, next) => {
      console.log('Socket connection attempt:', {
        token: socket.handshake.auth.token,
        walletAddress: socket.handshake.auth.walletAddress
      });
      
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        console.log('No token provided');
        return next(new Error('Authentication error: Token required'));
      }

      try {
        const { verifyToken } = require('../config/jwt');
        const decoded = verifyToken(token);
        console.log('Token verified for:', decoded.walletAddress);
        socket.user = decoded;
        next();
      } catch (error) {
        console.log('Token verification failed:', error.message);
        return next(new Error('Authentication error: Invalid token'));
      }
    });

    this.userRooms = new Map(); // userId -> Set of roomIds
    this.initializeHandlers();
  }

  initializeHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.user.walletAddress}`);

      // Join user's rooms on connection
      this.joinUserRooms(socket);

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
      const userResult = await UserQueries.getUserByWallet(socket.user.walletAddress);
      if (!userResult.rows.length) return;

      const userId = userResult.rows[0].id;
      
      // Get user's approved rooms
      const query = `
        SELECT room_id FROM room_members 
        WHERE user_id = $1 AND status = 'approved'
      `;
      const result = await db.query(query, [userId]);

      const roomSet = new Set();
      result.rows.forEach(row => {
        const roomId = row.room_id;
        socket.join(roomId);
        roomSet.add(roomId);
      });

      this.userRooms.set(userId, roomSet);
      
      socket.emit('rooms_joined', {
        rooms: Array.from(roomSet),
        count: roomSet.size
      });
    } catch (error) {
      console.error('Join user rooms error:', error);
    }
  }

  async handleJoinRoom(socket, data) {
    try {
      const { roomId } = data;
      const userResult = await UserQueries.getUserByWallet(socket.user.walletAddress);
      
      if (!userResult.rows.length) {
        return socket.emit('error', { message: 'User not found' });
      }

      const userId = userResult.rows[0].id;

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
      
      // Update userRooms map
      if (!this.userRooms.has(userId)) {
        this.userRooms.set(userId, new Set());
      }
      this.userRooms.get(userId).add(roomId);

      // Notify others in room
      socket.to(roomId).emit('user_joined', {
        walletAddress: socket.user.walletAddress,
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
    socket.leave(roomId);

    // Notify others in room
    socket.to(roomId).emit('user_left', {
      walletAddress: socket.user.walletAddress,
      timestamp: new Date().toISOString()
    });

    socket.emit('room_left', { roomId, success: true });
  }

  async handleSendMessage(socket, data) {
    try {
      const { roomId, content, parentMessageId } = data;
      
      if (!content || content.trim().length === 0) {
        return socket.emit('error', { message: 'Message content required' });
      }

      const userResult = await UserQueries.getUserByWallet(socket.user.walletAddress);
      if (!userResult.rows.length) {
        return socket.emit('error', { message: 'User not found' });
      }

      const userId = userResult.rows[0].id;

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
        sender_wallet: socket.user.walletAddress,
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

  handleTyping(socket, data) {
    const { roomId } = data;
    
    // Notify others in room
    socket.to(roomId).emit('user_typing', {
      walletAddress: socket.user.walletAddress,
      roomId,
      timestamp: new Date().toISOString()
    });
  }

  handleTypingStop(socket, data) {
    const { roomId } = data;
    
    socket.to(roomId).emit('user_typing_stop', {
      walletAddress: socket.user.walletAddress,
      roomId
    });
  }

  async handleLikeMessage(socket, data) {
    try {
      const { messageId, reactionType = 'like' } = data;
      
      const userResult = await UserQueries.getUserByWallet(socket.user.walletAddress);
      if (!userResult.rows.length) {
        return socket.emit('error', { message: 'User not found' });
      }

      const userId = userResult.rows[0].id;

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
        walletAddress: socket.user.walletAddress,
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
      
      const userResult = await UserQueries.getUserByWallet(socket.user.walletAddress);
      if (!userResult.rows.length) {
        return socket.emit('error', { message: 'User not found' });
      }

      const userId = userResult.rows[0].id;

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
        walletAddress: socket.user.walletAddress,
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
    console.log(`User disconnected: ${socket.user.walletAddress}`);
  }

  // Helper method to notify room members
  notifyRoom(roomId, event, data) {
    this.io.to(roomId).emit(event, data);
  }
}

module.exports = SocketService;