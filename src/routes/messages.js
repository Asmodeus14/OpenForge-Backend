const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const MessageQueries = require('../db/queries/messages');

// Add missing db import
const db = require('../config/db');

// Get room messages
router.get('/rooms/:roomId/messages', authMiddleware.authenticateToken, authMiddleware.checkRoomMember, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    // Check if user can view room
    const canView = await MessageQueries.checkUserCanViewRoom(userId, roomId);
    if (!canView.rows.length || canView.rows[0].status !== 'approved') {
      return res.status(403).json({ error: 'Access denied or pending approval' });
    }

    const result = await MessageQueries.getRoomMessages(
      roomId, 
      parseInt(limit), 
      before
    );

    res.json({
      messages: result.rows,
      pagination: {
        limit: parseInt(limit),
        hasMore: result.rows.length === parseInt(limit),
        lastMessageDate: result.rows.length > 0 ? result.rows[result.rows.length - 1].created_at : null
      }
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message
router.post('/rooms/:roomId/messages', authMiddleware.authenticateToken, authMiddleware.checkRoomMember, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content, parentMessageId } = req.body;
    const senderId = req.user.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Check if user is approved member
    const canSend = await MessageQueries.checkUserCanViewRoom(senderId, roomId);
    if (!canSend.rows.length || canSend.rows[0].status !== 'approved') {
      return res.status(403).json({ error: 'Must be approved member to send messages' });
    }

    const result = await MessageQueries.createMessage(
      roomId, 
      senderId, 
      content.trim(), 
      parentMessageId
    );

    const message = result.rows[0];
    
    // Get sender wallet for response
    const userQuery = 'SELECT wallet_address FROM users WHERE id = $1';
    const userResult = await db.query(userQuery, [senderId]);
    
    res.status(201).json({
      success: true,
      message: {
        ...message,
        sender_wallet: userResult.rows[0].wallet_address,
        like_count: 0,
        liked_by: []
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Edit message
router.put('/messages/:messageId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const senderId = req.user.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content required' });
    }

    const result = await MessageQueries.updateMessage(
      messageId, 
      content.trim(), 
      senderId
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }

    res.json({
      success: true,
      message: result.rows[0]
    });
  } catch (error) {
    console.error('Edit message error:', error);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Delete message
router.delete('/messages/:messageId', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const senderId = req.user.id;

    const result = await MessageQueries.deleteMessage(messageId, senderId);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Like message
router.post('/messages/:messageId/like', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reactionType = 'like' } = req.body;
    const userId = req.user.id;

    // Check if user can access the message (must be member of the room)
    const accessQuery = `
      SELECT m.room_id 
      FROM messages m
      JOIN room_members rm ON m.room_id = rm.room_id
      WHERE m.id = $1 AND rm.user_id = $2 AND rm.status = 'approved'
    `;
    const accessResult = await db.query(accessQuery, [messageId, userId]);

    if (!accessResult.rows.length) {
      return res.status(403).json({ error: 'Cannot like this message' });
    }

    const result = await MessageQueries.likeMessage(messageId, userId, reactionType);

    res.json({
      success: true,
      like: result.rows[0]
    });
  } catch (error) {
    console.error('Like message error:', error);
    res.status(500).json({ error: 'Failed to like message' });
  }
});

// Unlike message
router.delete('/messages/:messageId/like', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reactionType = 'like' } = req.query;
    const userId = req.user.id;

    const result = await MessageQueries.unlikeMessage(messageId, userId, reactionType);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Like not found' });
    }

    res.json({
      success: true,
      message: 'Like removed successfully'
    });
  } catch (error) {
    console.error('Unlike message error:', error);
    res.status(500).json({ error: 'Failed to unlike message' });
  }
});

// Get message likes
router.get('/messages/:messageId/likes', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;

    // Check if user can access the message
    const accessQuery = `
      SELECT m.room_id 
      FROM messages m
      JOIN room_members rm ON m.room_id = rm.room_id
      WHERE m.id = $1 AND rm.user_id = $2 AND rm.status = 'approved'
    `;
    const accessResult = await db.query(accessQuery, [messageId, userId]);

    if (!accessResult.rows.length) {
      return res.status(403).json({ error: 'Cannot view likes for this message' });
    }

    const result = await MessageQueries.getMessageLikes(messageId);

    res.json({
      likes: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Get likes error:', error);
    res.status(500).json({ error: 'Failed to get likes' });
  }
});

module.exports = router;