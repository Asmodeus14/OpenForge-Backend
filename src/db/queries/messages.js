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

  /**
   * A page of a room's history, newest first, with reaction state attached.
   *
   * `liked_by` is the real list of wallets that reacted. An earlier version
   * synthesised it from `is_liked_by_me`, so a message reacted to by five
   * people reported `like_count: 5` alongside a `liked_by` containing only the
   * caller — the API stated a list of reactors that was not the list of
   * reactors.
   *
   * The page is selected first and the reactions joined to it, so reactions are
   * only ever aggregated for the rows being returned. `idx_messages_room`
   * (room_id, created_at) serves the CTE and `idx_message_likes_message` serves
   * the lateral.
   *
   * `like_count` counts reactions of every type, matching `getMessageLikes` and
   * the socket's `new_message` payload. `message_likes` allows an arbitrary
   * `reaction_type`, so this is a total, not a count of thumbs-up.
   *
   * Pagination accepts either `offset` (what the web client sends) or `before`
   * as a `created_at` cursor. `before` wins when both are given, since a cursor
   * cannot skip or repeat rows when new messages arrive mid-scroll.
   */
  getRoomMessages: async (roomId, userId, { limit = 50, offset = 0, before = null } = {}) => {
    const params = [roomId, userId];
    const cursor = before ? ` AND m.created_at < $${params.push(before)}` : '';
    const limitParam = params.push(limit);
    const offsetParam = params.push(before ? 0 : offset);

    const query = `
      WITH page AS (
        SELECT m.*
        FROM messages m
        WHERE m.room_id = $1${cursor}
        ORDER BY m.created_at DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}
      )
      SELECT
        p.*,
        u.wallet_address AS sender_wallet,
        COALESCE(l.like_count, 0) AS like_count,
        COALESCE(l.liked_by, ARRAY[]::varchar[]) AS liked_by,
        COALESCE(l.liked_by_me, false) AS is_liked_by_me
      FROM page p
      JOIN users u ON u.id = p.sender_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS like_count,
          ARRAY_AGG(lu.wallet_address ORDER BY ml.created_at) AS liked_by,
          BOOL_OR(ml.user_id = $2) AS liked_by_me
        FROM message_likes ml
        JOIN users lu ON lu.id = ml.user_id
        WHERE ml.message_id = p.id
      ) l ON TRUE
      ORDER BY p.created_at DESC
    `;

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
  },
};

module.exports = MessageQueries;
