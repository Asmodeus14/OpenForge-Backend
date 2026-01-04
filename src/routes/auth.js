const express = require('express');
const router = express.Router();
const { generateToken } = require('../config/jwt');
const UserQueries = require('../db/queries/users');
const authMiddleware = require('../middleware/auth');
require('dotenv').config();

// Get nonce for wallet
router.post('/nonce', async (req, res) => {
  try {
    const { walletAddress } = req.body;

    // Simple wallet address validation without ethers
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Valid Ethereum wallet address required' });
    }

    const result = await UserQueries.createOrUpdateUser(walletAddress);
    const user = result.rows[0];

    res.json({ 
      nonce: user.nonce,
      message: `${process.env.SIGNING_MESSAGE} ${user.nonce}`
    });
  } catch (error) {
    console.error('Nonce generation error:', error);
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

// Verify signature and get JWT
router.post('/verify', authMiddleware.verifySignature, async (req, res) => {
  try {
    const user = req.user;
    
    // Generate new nonce for next login
    await UserQueries.updateUserNonce(user.wallet_address, Math.floor(Math.random() * 1000000).toString());
    
    // Generate JWT
    const token = generateToken(user.wallet_address);
    
    res.json({
      token,
      user: {
        walletAddress: user.wallet_address,
        id: user.id,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', authMiddleware.authenticateToken, (req, res) => {
  try {
    const token = generateToken(req.user.wallet_address);
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Get user profile
router.get('/me', authMiddleware.authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    
    // Get user's rooms
    const db = require('../../config/db');
    const roomsQuery = `
      SELECT COUNT(*) as room_count 
      FROM room_members 
      WHERE user_id = $1 AND status = 'approved'
    `;
    const roomsResult = await db.query(roomsQuery, [user.id]);
    
    res.json({
      walletAddress: user.wallet_address,
      id: user.id,
      createdAt: user.created_at,
      lastLogin: user.last_login,
      roomCount: parseInt(roomsResult.rows[0].room_count) || 0
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;