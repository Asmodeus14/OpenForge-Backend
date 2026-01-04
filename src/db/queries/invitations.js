const db = require('../../config/db');

const InvitationQueries = {
  createInvitation: async (roomId, inviterId, inviteeWalletAddress) => {
    const query = `
      INSERT INTO room_invitations (room_id, inviter_id, invitee_wallet_address)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    return await db.query(query, [roomId, inviterId, inviteeWalletAddress]);
  },

  getInvitation: async (invitationId) => {
    const query = `
      SELECT ri.*, u.wallet_address as inviter_wallet
      FROM room_invitations ri
      JOIN users u ON ri.inviter_id = u.id
      WHERE ri.id = $1 AND ri.expires_at > CURRENT_TIMESTAMP
    `;
    return await db.query(query, [invitationId]);
  },

  getUserInvitations: async (walletAddress) => {
    // FIXED: Added LOWER() for case-insensitive comparison and proper table aliases
    const query = `
      SELECT 
        ri.*, 
        cr.name as room_name, 
        u.wallet_address as inviter_wallet,
        cr.description as room_description,
        cr.room_type,
        cr.admin_id
      FROM room_invitations ri
      JOIN chat_rooms cr ON ri.room_id = cr.id
      JOIN users u ON ri.inviter_id = u.id
      WHERE LOWER(ri.invitee_wallet_address) = LOWER($1) 
      AND ri.status = 'pending'
      AND ri.expires_at > CURRENT_TIMESTAMP
      AND cr.is_active = true
      ORDER BY ri.created_at DESC
    `;
    return await db.query(query, [walletAddress]);
  },

  updateInvitationStatus: async (invitationId, status) => {
    const query = `
      UPDATE room_invitations 
      SET status = $2
      WHERE id = $1
      RETURNING *
    `;
    return await db.query(query, [invitationId, status]);
  }
};

module.exports = InvitationQueries;