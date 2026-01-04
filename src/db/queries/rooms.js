const db = require('../../config/db');

const RoomQueries = {
  createRoom: async (name, description, roomType, adminId) => {
    const query = `
      INSERT INTO chat_rooms (name, description, room_type, admin_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    return await db.query(query, [name, description, roomType, adminId]);
  },

  getRoomById: async (roomId) => {
    const query = `
      SELECT cr.*, u.wallet_address as admin_wallet
      FROM chat_rooms cr
      JOIN users u ON cr.admin_id = u.id
      WHERE cr.id = $1 AND cr.is_active = true
    `;
    return await db.query(query, [roomId]);
  },

  getPublicRooms: async (limit = 50, offset = 0) => {
    const query = `
      SELECT cr.*, u.wallet_address as admin_wallet,
             COUNT(rm.user_id) as member_count
      FROM chat_rooms cr
      JOIN users u ON cr.admin_id = u.id
      LEFT JOIN room_members rm ON cr.id = rm.room_id AND rm.status = 'approved'
      WHERE cr.room_type = 'public' AND cr.is_active = true
      GROUP BY cr.id, u.wallet_address
      ORDER BY cr.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    return await db.query(query, [limit, offset]);
  },

  getUserRooms: async (userId) => {
    const query = `
      SELECT cr.*, u.wallet_address as admin_wallet,
             rm.status, rm.is_admin
      FROM room_members rm
      JOIN chat_rooms cr ON rm.room_id = cr.id
      JOIN users u ON cr.admin_id = u.id
      WHERE rm.user_id = $1 
      AND rm.status IN ('approved', 'pending')
      AND cr.is_active = true
      ORDER BY cr.updated_at DESC
    `;
    return await db.query(query, [userId]);
  },

  addRoomMember: async (roomId, userId, status = 'pending', isAdmin = false) => {
    const query = `
      INSERT INTO room_members (room_id, user_id, status, is_admin)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (room_id, user_id) 
      DO UPDATE SET status = EXCLUDED.status
      RETURNING *
    `;
    return await db.query(query, [roomId, userId, status, isAdmin]);
  },

  removeRoomMember: async (roomId, userId) => {
    const query = `
      DELETE FROM room_members 
      WHERE room_id = $1 AND user_id = $2
      RETURNING *
    `;
    return await db.query(query, [roomId, userId]);
  },

  updateMemberStatus: async (roomId, userId, status) => {
    const query = `
      UPDATE room_members 
      SET status = $3
      WHERE room_id = $1 AND user_id = $2
      RETURNING *
    `;
    return await db.query(query, [roomId, userId, status]);
  },

  getRoomMembers: async (roomId) => {
    const query = `
      SELECT u.wallet_address, rm.status, rm.is_admin, rm.joined_at
      FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = $1 AND rm.status = 'approved'
      ORDER BY rm.joined_at
    `;
    return await db.query(query, [roomId]);
  },

  // FIXED: Added user_id to the SELECT and returned as request_id
  getPendingRequests: async (roomId) => {
    const query = `
      SELECT 
        rm.id as request_id,
        rm.user_id,
        u.wallet_address,
        rm.status,
        rm.joined_at
      FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = $1 AND rm.status = 'pending'
      ORDER BY rm.joined_at DESC
    `;
    return await db.query(query, [roomId]);
  },

  deleteRoom: async (roomId) => {
    const query = `
      UPDATE chat_rooms 
      SET is_active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    return await db.query(query, [roomId]);
  },

  getP2PRoom: async (user1Id, user2Id) => {
    const query = `
      SELECT cr.*
      FROM chat_rooms cr
      JOIN room_members rm1 ON cr.id = rm1.room_id
      JOIN room_members rm2 ON cr.id = rm2.room_id
      WHERE cr.room_type = 'p2p'
      AND rm1.user_id = $1
      AND rm2.user_id = $2
      AND cr.is_active = true
      LIMIT 1
    `;
    return await db.query(query, [user1Id, user2Id]);
  },

  createP2PRoom: async (user1Id, user2Id) => {
    // Use the PostgreSQL function
    const query = `SELECT create_or_get_p2p_room($1, $2) as room_id`;
    const user1 = await db.query('SELECT wallet_address FROM users WHERE id = $1', [user1Id]);
    const user2 = await db.query('SELECT wallet_address FROM users WHERE id = $2', [user2Id]);
    
    return await db.query(query, [
      user1.rows[0].wallet_address,
      user2.rows[0].wallet_address
    ]);
  },

  // ADDED: Function to get room messages
  getRoomMessages: async (roomId, limit = 50, offset = 0) => {
    const query = `
      SELECT 
        m.*,
        u.wallet_address as sender_wallet
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    return await db.query(query, [roomId, limit, offset]);
  },

  // ADDED: Function to send a message (if not already in a separate queries file)
  sendMessage: async (roomId, senderId, content) => {
    const query = `
      INSERT INTO messages (room_id, sender_id, content)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    return await db.query(query, [roomId, senderId, content]);
  }
};

module.exports = RoomQueries;