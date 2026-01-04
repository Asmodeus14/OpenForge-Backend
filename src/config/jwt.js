const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '7d'
};

const generateToken = (walletAddress) => {
  return jwt.sign(
    { walletAddress },
    JWT_CONFIG.secret,
    { expiresIn: JWT_CONFIG.expiresIn }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_CONFIG.secret);
  } catch (error) {
    throw new Error('Invalid token');
  }
};

module.exports = {
  generateToken,
  verifyToken,
  JWT_CONFIG
};