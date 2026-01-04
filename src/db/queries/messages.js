const db = require('../../config/db');

const MessageQueries = {
  createMessage: async (roomId, senderId, content, parentMessageId = null) => {
    const query = `
      INSERT INTO messages (room_id, sender_id, content, parent_message_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    return await db.query(query, [roomId, senderId, content, parentMessageId]);
  },

  getRoomMessages: async (roomId, limit = 50, before = null) => {
    let query = `
      SELECT m.*, u.wallet_address as sender_wallet,
             COUNT(ml.id) as like_count,
             ARRAY_AGG(DISTINCT ul.wallet_address) as liked_by
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN message_likes ml ON m.id = ml.message_id
      LEFT JOIN users ul ON ml.user_id = ul.id
      WHERE m.room_id = $1
    `;
    
    const params = [roomId];
    
    if (before) {
      query += ` AND m.created_at < $2`;
      params.push(before);
    }
    
    query += `
      GROUP BY m.id, u.wallet_address
      ORDER BY m.created_at DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);
    
    return await db.query(query, params);
  },

  updateMessage: async (messageId, content, senderId) => {
    const query = `
      UPDATE messages 
      SET content = $2, is_edited = true, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND sender_id = $3
      RETURNING *
    `;
    return await db.query(query, [messageId, content, senderId]);
  },

  deleteMessage: async (messageId, senderId) => {
    const query = `
      DELETE FROM messages 
      WHERE id = $1 AND sender_id = $2
      RETURNING *
    `;
    return await db.query(query, [messageId, senderId]);
  },

  likeMessage: async (messageId, userId, reactionType = 'like') => {
    const query = `
      INSERT INTO message_likes (message_id, user_id, reaction_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (message_id, user_id, reaction_type) 
      DO NOTHING
      RETURNING *
    `;
    return await db.query(query, [messageId, userId, reactionType]);
  },

  unlikeMessage: async (messageId, userId, reactionType = 'like') => {
    const query = `
      DELETE FROM message_likes 
      WHERE message_id = $1 AND user_id = $2 AND reaction_type = $3
      RETURNING *
    `;
    return await db.query(query, [messageId, userId, reactionType]);
  },

  getMessageLikes: async (messageId) => {
    const query = `
      SELECT ml.*, u.wallet_address
      FROM message_likes ml
      JOIN users u ON ml.user_id = u.id
      WHERE ml.message_id = $1
      ORDER BY ml.created_at
    `;
    return await db.query(query, [messageId]);
  },

  checkUserCanViewRoom: async (userId, roomId) => {
    const query = `
      SELECT rm.status 
      FROM room_members rm
      WHERE rm.user_id = $1 AND rm.room_id = $2
      AND rm.status IN ('approved', 'pending')
    `;
    return await db.query(query, [userId, roomId]);
  }
};

module.exports = MessageQueries;