const db = require('../../config/db');

const UserQueries = {
  // Create or update user with new nonce
  createOrUpdateUser: async (walletAddress) => {
    const nonce = Math.floor(Math.random() * 1000000).toString();
    const query = `
      INSERT INTO users (wallet_address, nonce, last_login)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (wallet_address) 
      DO UPDATE SET 
        nonce = EXCLUDED.nonce,
        last_login = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    return await db.query(query, [walletAddress, nonce]);
  },

  getUserByWallet: async (walletAddress) => {
    const query = 'SELECT * FROM users WHERE wallet_address = $1';
    return await db.query(query, [walletAddress]);
  },

  getUserById: async (userId) => {
    const query = 'SELECT * FROM users WHERE id = $1';
    return await db.query(query, [userId]);
  },

  updateUserNonce: async (walletAddress, nonce) => {
    const query = `
      UPDATE users 
      SET nonce = $2, updated_at = CURRENT_TIMESTAMP 
      WHERE wallet_address = $1 
      RETURNING nonce
    `;
    return await db.query(query, [walletAddress, nonce]);
  }
};

module.exports = UserQueries;