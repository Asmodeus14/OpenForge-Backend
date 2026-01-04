const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const InvitationQueries = require('../db/queries/invitations');
const db = require('../config/db');

// Get user invitations
router.get('/', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const walletAddress = req.user.wallet_address;
    console.log(`[GET /invitations] Fetching for wallet: ${walletAddress}`);
    
    // Direct debugging queries
    console.log(`[DEBUG] Checking wallet: ${walletAddress}`);
    
    // Check raw count first
    const countQuery = `
      SELECT COUNT(*) as count 
      FROM room_invitations 
      WHERE LOWER(invitee_wallet_address) = LOWER($1)
    `;
    
    const countResult = await db.query(countQuery, [walletAddress]);
    console.log(`[DEBUG] Total invitations for wallet: ${countResult.rows[0].count}`);
    
    // Check pending ones
    const pendingQuery = `
      SELECT COUNT(*) as count 
      FROM room_invitations 
      WHERE LOWER(invitee_wallet_address) = LOWER($1)
        AND status = 'pending'
    `;
    
    const pendingResult = await db.query(pendingQuery, [walletAddress]);
    console.log(`[DEBUG] Pending invitations: ${pendingResult.rows[0].count}`);
    
    // Now get the full invitations
    const result = await InvitationQueries.getUserInvitations(walletAddress);
    
    console.log(`[GET /invitations] Query returned ${result.rows.length} rows`);
    
    if (result.rows.length > 0) {
      console.log(`[GET /invitations] First invitation:`, {
        id: result.rows[0].id,
        room_name: result.rows[0].room_name,
        inviter_wallet: result.rows[0].inviter_wallet,
        invitee_wallet: result.rows[0].invitee_wallet_address,
        status: result.rows[0].status,
        expires_at: result.rows[0].expires_at
      });
    }
    
    res.json({
      success: true,
      invitations: result.rows.map(invite => ({
        id: invite.id,
        room_id: invite.room_id,
        room_name: invite.room_name,
        room_description: invite.room_description,
        room_type: invite.room_type,
        inviter_id: invite.inviter_id,
        inviter_wallet: invite.inviter_wallet,
        invitee_wallet_address: invite.invitee_wallet_address,
        status: invite.status,
        created_at: invite.created_at,
        expires_at: invite.expires_at
      }))
    });
    
  } catch (error) {
    console.error('[GET /invitations] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get invitations',
      details: error.message 
    });
  }
});

// Accept invitation
router.post('/:invitationId/accept', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { invitationId } = req.params;
    const userId = req.user.id;
    const walletAddress = req.user.wallet_address;

    console.log(`[POST /invitations/accept] ${invitationId} for ${walletAddress}`);

    // Start transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Get invitation
      const invitationResult = await InvitationQueries.getInvitation(invitationId);
      
      if (!invitationResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ 
          success: false, 
          error: 'Invitation not found or expired' 
        });
      }

      const invitation = invitationResult.rows[0];
      console.log(`[POST /invitations/accept] Found invitation:`, invitation);

      // Verify invitation is for this user (case-insensitive)
      if (invitation.invitee_wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
        await client.query('ROLLBACK');
        return res.status(403).json({ 
          success: false, 
          error: 'Invitation not for this user' 
        });
      }

      // Update invitation status
      await client.query(
        'UPDATE room_invitations SET status = $1 WHERE id = $2',
        ['accepted', invitationId]
      );

      // Check if user is already a member
      const memberCheck = await client.query(
        'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2',
        [invitation.room_id, userId]
      );

      if (memberCheck.rows.length === 0) {
        // Add user to room
        await client.query(
          `INSERT INTO room_members (room_id, user_id, status, is_admin, joined_at) 
           VALUES ($1, $2, $3, $4, NOW())`,
          [invitation.room_id, userId, 'approved', false]
        );
      } else {
        // Update existing membership
        await client.query(
          `UPDATE room_members SET status = $1, left_at = NULL WHERE room_id = $2 AND user_id = $3`,
          ['approved', invitation.room_id, userId]
        );
      }

      await client.query('COMMIT');
      
      console.log(`[POST /invitations/accept] Success for ${invitationId}`);
      res.json({
        success: true,
        message: 'Invitation accepted successfully'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[POST /invitations/accept] Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to accept invitation',
      details: error.message 
    });
  }
});

// Reject invitation (keep as is, works fine)
router.post('/:invitationId/reject', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { invitationId } = req.params;
    const walletAddress = req.user.wallet_address;

    // Get invitation
    const invitationResult = await InvitationQueries.getInvitation(invitationId);
    
    if (!invitationResult.rows.length) {
      return res.status(404).json({ error: 'Invitation not found or expired' });
    }

    const invitation = invitationResult.rows[0];

    // Verify invitation is for this user
    if (invitation.invitee_wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(403).json({ error: 'Invitation not for this user' });
    }

    // Update invitation status
    await InvitationQueries.updateInvitationStatus(invitationId, 'rejected');

    res.json({
      success: true,
      message: 'Invitation rejected'
    });
  } catch (error) {
    console.error('Reject invitation error:', error);
    res.status(500).json({ error: 'Failed to reject invitation' });
  }
});

module.exports = router;