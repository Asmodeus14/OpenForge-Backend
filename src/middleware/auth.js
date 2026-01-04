const { ethers } = require('ethers');
const { verifyToken } = require('../config/jwt');
const UserQueries = require('../db/queries/users');
const MessageQueries = require('../db/queries/messages');
const db = require('../config/db'); // Add this import at the top

const verifyWalletSignature = (message, signature, walletAddress) => {
  try {
    // Recover the address from the signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    // Compare recovered address with provided address (case-insensitive)
    return recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

const authMiddleware = {
  // Verify JWT token
  authenticateToken: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        return res.status(401).json({ error: 'Access token required' });
      }

      const decoded = verifyToken(token);
      const userResult = await UserQueries.getUserByWallet(decoded.walletAddress);

      if (!userResult.rows.length) {
        return res.status(401).json({ error: 'User not found' });
      }

      req.user = userResult.rows[0];
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  },

  // Verify wallet signature for login
  verifySignature: async (req, res, next) => {
    try {
      const { walletAddress, signature } = req.body;

      if (!walletAddress || !signature) {
        return res.status(400).json({ error: 'Wallet address and signature required' });
      }

      // Validate wallet address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      // Validate signature format
      if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
        return res.status(400).json({ error: 'Invalid signature format' });
      }

      // Get user and their nonce
      const userResult = await UserQueries.getUserByWallet(walletAddress);
      
      if (!userResult.rows.length) {
        return res.status(404).json({ error: 'User not found. Please get nonce first.' });
      }

      const user = userResult.rows[0];
      const message = `${process.env.SIGNING_MESSAGE} ${user.nonce}`;

      // Verify signature
      const isValid = verifyWalletSignature(message, signature, walletAddress);

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      req.user = user;
      next();
    } catch (error) {
      console.error('Signature verification error:', error);
      return res.status(500).json({ error: 'Signature verification failed' });
    }
  },

  // Socket.IO authentication middleware
  authenticateSocket: (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: Token required'));
      }

      const decoded = verifyToken(token);
      socket.user = decoded;
      next();
    } catch (error) {
      return next(new Error('Authentication error: Invalid token'));
    }
  },

  // Check if user is room admin - FIXED: Using imported db
  checkRoomAdmin: async (req, res, next) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      const query = `
        SELECT rm.is_admin 
        FROM room_members rm
        WHERE rm.room_id = $1 AND rm.user_id = $2 AND rm.status = 'approved'
      `;
      
      const result = await db.query(query, [roomId, userId]);

      if (!result.rows.length || !result.rows[0].is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      next();
    } catch (error) {
      console.error('Admin check error:', error);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  },

  // Check if user is room member - FIXED: Using imported db
  checkRoomMember: async (req, res, next) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      const query = `
        SELECT rm.status 
        FROM room_members rm
        WHERE rm.user_id = $1 AND rm.room_id = $2
        AND rm.status IN ('approved', 'pending')
      `;
      
      const result = await db.query(query, [userId, roomId]);

      if (!result.rows.length) {
        return res.status(403).json({ error: 'Not a member of this room' });
      }

      next();
    } catch (error) {
      console.error('Member check error:', error);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  }
};

module.exports = authMiddleware;