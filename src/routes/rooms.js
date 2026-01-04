const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RoomQueries = require('../db/queries/rooms');
const UserQueries = require('../db/queries/users');
const InvitationQueries = require('../db/queries/invitations');
const { ethers } = require('ethers');
const db = require('../config/db');

// Helper function to validate room ID
const validateRoomId = (roomId) => {
  if (!roomId || roomId === 'undefined' || roomId === 'null') {
    throw new Error('Invalid room ID');
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(roomId)) {
    throw new Error('Invalid room ID format');
  }
  return true;
};

// Create a new room
router.post('/', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { name, description, roomType } = req.body;
    const adminId = req.user.id;

    if (!name || !roomType) {
      return res.status(400).json({ error: 'Name and room type required' });
    }

    if (!['public', 'private', 'p2p'].includes(roomType)) {
      return res.status(400).json({ error: 'Invalid room type' });
    }

    const result = await RoomQueries.createRoom(name, description, roomType, adminId);
    const room = result.rows[0];

    // Add creator as admin member
    await RoomQueries.addRoomMember(room.id, adminId, 'approved', true);

    res.status(201).json({
      success: true,
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        roomType: room.room_type,
        adminId: room.admin_id,
        createdAt: room.created_at
      }
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get public rooms
router.get('/public', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await RoomQueries.getPublicRooms(parseInt(limit), parseInt(offset));
    
    res.json({
      rooms: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Get public rooms error:', error);
    res.status(500).json({ error: 'Failed to get public rooms' });
  }
});

// Get user's rooms
router.get('/my', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await RoomQueries.getUserRooms(userId);
    
    // Separate approved and pending rooms
    const approvedRooms = result.rows.filter(r => r.status === 'approved');
    const pendingRooms = result.rows.filter(r => r.status === 'pending');
    
    res.json({
      approvedRooms,
      pendingRooms
    });
  } catch (error) {
    console.error('Get user rooms error:', error);
    res.status(500).json({ error: 'Failed to get user rooms' });
  }
});

// Get room details
router.get('/:roomId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    
    // Validate roomId
    validateRoomId(roomId);
    
    const userId = req.user.id;
    
    // Check if user is a member of the room
    const memberCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND status IN ($3, $4)',
      [roomId, userId, 'approved', 'pending']
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }
    
    const roomResult = await RoomQueries.getRoomById(roomId);
    
    if (!roomResult.rows.length) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];
    const members = await RoomQueries.getRoomMembers(roomId);
    
    // Check if user is admin
    const isAdmin = memberCheck.rows[0].is_admin;
    
    res.json({
      ...room,
      members: members.rows,
      is_admin: isAdmin
    });
  } catch (error) {
    console.error('Get room details error:', error);
    res.status(500).json({ error: 'Failed to get room details' });
  }
});

// Request to join public room
router.post('/:roomId/join', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Validate roomId
    validateRoomId(roomId);

    // Check room exists and is public
    const roomResult = await RoomQueries.getRoomById(roomId);
    if (!roomResult.rows.length) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];
    
    if (room.room_type !== 'public') {
      return res.status(400).json({ error: 'Room is not public' });
    }

    // Check if already a member
    const existingQuery = `
      SELECT * FROM room_members 
      WHERE room_id = $1 AND user_id = $2
    `;
    const existingResult = await db.query(existingQuery, [roomId, userId]);

    if (existingResult.rows.length) {
      const status = existingResult.rows[0].status;
      return res.status(400).json({ 
        error: `Already ${status === 'pending' ? 'requested to join' : 'a member'}`
      });
    }

    // Add as pending member (admin needs to approve)
    const result = await RoomQueries.addRoomMember(roomId, userId, 'pending', false);
    
    res.json({
      success: true,
      status: 'pending',
      message: 'Join request sent to admin'
    });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Invite user to private room (admin only)
router.post('/:roomId/invite', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { walletAddress } = req.body;
    const inviterId = req.user.id;
    
    // Validate roomId
    validateRoomId(roomId);

    // Validate wallet address
    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Valid wallet address required' });
    }

    // Check if user is admin of the room
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, inviterId]
    );
    
    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can invite users' });
    }

    // Check if room is private
    const roomResult = await RoomQueries.getRoomById(roomId);
    if (roomResult.rows[0].room_type !== 'private') {
      return res.status(400).json({ error: 'Only private rooms support invitations' });
    }

    // Check if invitation already exists
    const existingInvite = await db.query(
      'SELECT * FROM room_invitations WHERE room_id = $1 AND invitee_wallet_address = $2 AND status = $3',
      [roomId, walletAddress.toLowerCase(), 'pending']
    );
    
    if (existingInvite.rows.length > 0) {
      return res.status(400).json({ error: 'Invitation already sent to this user' });
    }

    // Create invitation
    const result = await InvitationQueries.createInvitation(roomId, inviterId, walletAddress);
    
    res.status(201).json({
      success: true,
      invitation: result.rows[0],
      message: 'Invitation sent'
    });
  } catch (error) {
    console.error('Invite user error:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Get pending join requests (admin only)
// Get pending join requests (admin only) - UPDATED to use RoomQueries.getPendingRequests
router.get('/:roomId/requests', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Validate roomId
    validateRoomId(roomId);
    
    // Check if user is admin of the room
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, userId]
    );
    
    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can view requests' });
    }
    
    // Use RoomQueries.getPendingRequests which now returns the correct fields
    const result = await RoomQueries.getPendingRequests(roomId);
    
    console.log(`Found ${result.rows.length} pending requests for room ${roomId}`);
    
    res.json({
      success: true,
      requests: result.rows.map(row => ({
        id: row.request_id,
        user_id: row.user_id,
        wallet_address: row.wallet_address,
        status: row.status,
        created_at: row.joined_at, // Use joined_at as created_at
        joined_at: row.joined_at
      }))
    });
    
  } catch (error) {
    console.error('Get room requests error:', error);
    res.status(500).json({ error: 'Failed to get room requests' });
  }
});
// Approve a join request (admin only) - SEPARATE ROUTE FOR APPROVE
router.post('/:roomId/requests/:requestId/approve', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const adminId = req.user.id;

    console.log(`[POST /rooms/${roomId}/requests/${requestId}/approve] by admin: ${adminId}`);

    // Validate IDs
    if (!roomId || roomId === 'undefined' || roomId === 'null') {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    if (!requestId || requestId === 'undefined' || requestId === 'null') {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    // Verify user is admin of the room
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, adminId]
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can approve requests' });
    }

    // Get the pending request
    const requestCheck = await db.query(
      `SELECT rm.*, u.wallet_address 
       FROM room_members rm
       JOIN users u ON rm.user_id = u.id
       WHERE rm.id = $1 AND rm.room_id = $2 AND rm.status = 'pending'`,
      [requestId, roomId]
    );

    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already processed' });
    }

    // Update the request status to approved
    await db.query(
      `UPDATE room_members 
       SET status = 'approved', joined_at = NOW() 
       WHERE id = $1 AND room_id = $2`,
      [requestId, roomId]
    );

    console.log(`Request ${requestId} approved successfully`);

    res.json({
      success: true,
      message: 'Join request approved successfully'
    });

  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// Reject a join request (admin only) - SEPARATE ROUTE FOR REJECT
router.post('/:roomId/requests/:requestId/reject', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId, requestId } = req.params;
    const adminId = req.user.id;

    console.log(`[POST /rooms/${roomId}/requests/${requestId}/reject] by admin: ${adminId}`);

    // Validate IDs
    if (!roomId || roomId === 'undefined' || roomId === 'null') {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    if (!requestId || requestId === 'undefined' || requestId === 'null') {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    // Verify user is admin of the room
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, adminId]
    );

    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can reject requests' });
    }

    // Get the pending request
    const requestCheck = await db.query(
      `SELECT rm.* 
       FROM room_members rm
       WHERE rm.id = $1 AND rm.room_id = $2 AND rm.status = 'pending'`,
      [requestId, roomId]
    );

    if (requestCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already processed' });
    }

    // Update the request status to rejected
    await db.query(
      `UPDATE room_members 
       SET status = 'rejected' 
       WHERE id = $1 AND room_id = $2`,
      [requestId, roomId]
    );

    console.log(`Request ${requestId} rejected successfully`);

    res.json({
      success: true,
      message: 'Join request rejected'
    });

  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// Remove member from room (admin only)
router.delete('/:roomId/members/:walletAddress', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId, walletAddress } = req.params;
    const adminId = req.user.id;

    // Validate roomId
    validateRoomId(roomId);

    // Check if user is admin
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, adminId]
    );
    
    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can remove members' });
    }

    // Get user ID
    const userResult = await UserQueries.getUserByWallet(walletAddress);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Cannot remove self
    if (userId === adminId) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }

    // Remove member
    const result = await RoomQueries.removeRoomMember(roomId, userId);
    
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({
      success: true,
      message: 'Member removed from room'
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Leave room
router.post('/:roomId/leave', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    console.log(`[POST /rooms/${roomId}/leave] User ${userId} leaving room ${roomId}`);
    
    // Validate roomId
    validateRoomId(roomId);
    
    // Check if room exists
    const roomCheck = await db.query(
      'SELECT * FROM chat_rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );
    
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Check if user is a member of the room
    const memberCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(400).json({ error: 'You are not a member of this room' });
    }
    
    // Update member status to 'left'
    await db.query(
      `UPDATE room_members 
       SET status = 'left', left_at = NOW() 
       WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    
    // If user is admin and leaving, assign new admin if there are other members
    if (memberCheck.rows[0].is_admin) {
      // Find another member to make admin
      const otherMembers = await db.query(
        `SELECT user_id FROM room_members 
         WHERE room_id = $1 AND user_id != $2 AND status = 'approved' 
         ORDER BY joined_at ASC LIMIT 1`,
        [roomId, userId]
      );
      
      if (otherMembers.rows.length > 0) {
        await db.query(
          'UPDATE room_members SET is_admin = true WHERE room_id = $1 AND user_id = $2',
          [roomId, otherMembers.rows[0].user_id]
        );
      }
    }
    
    res.json({
      success: true,
      message: 'Successfully left the room'
    });
    
  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// Delete room (admin only)
router.delete('/:roomId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    
    // Validate roomId
    validateRoomId(roomId);
    
    // Check if user is admin of the room
    const adminCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND is_admin = true',
      [roomId, userId]
    );
    
    if (adminCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only room admin can delete room' });
    }
    
    const result = await RoomQueries.deleteRoom(roomId);
    
    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// Create or get P2P room
router.post('/p2p/:walletAddress', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const user1Id = req.user.id;

    // Validate wallet address
    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Get or create other user
    const userResult = await UserQueries.getUserByWallet(walletAddress);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user2Id = userResult.rows[0].id;

    // Check if P2P room already exists
    const existingRoom = await RoomQueries.getP2PRoom(user1Id, user2Id);
    
    if (existingRoom.rows.length) {
      return res.json({
        success: true,
        room: existingRoom.rows[0],
        isNew: false
      });
    }

    // Create new P2P room
    const result = await RoomQueries.createP2PRoom(user1Id, user2Id);
    const roomId = result.rows[0].room_id;
    const roomResult = await RoomQueries.getRoomById(roomId);
    
    res.status(201).json({
      success: true,
      room: roomResult.rows[0],
      isNew: true
    });
  } catch (error) {
    console.error('Create P2P room error:', error);
    res.status(500).json({ error: 'Failed to create P2P room' });
  }
});

// Get room messages
router.get('/:roomId/messages', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;
    
    // Validate roomId
    validateRoomId(roomId);
    
    // Check if user is a member of the room
    const memberCheck = await db.query(
      'SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2 AND status IN ($3, $4)',
      [roomId, userId, 'approved', 'pending']
    );
    
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'You are not a member of this room' });
    }
    
    const result = await RoomQueries.getRoomMessages(roomId, parseInt(limit), parseInt(offset));
    
    res.json({
      messages: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Get room messages error:', error);
    res.status(500).json({ error: 'Failed to get room messages' });
  }
});

module.exports = router;