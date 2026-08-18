const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Token configuration.
 *
 * The secret is the whole of the authentication system. A JWT carries only
 * `{ walletAddress }`, and `authenticateToken` trusts that claim verbatim — so
 * anyone who can guess or crack the secret can mint a token for any wallet,
 * including any room admin. There is no second factor and no revocation list.
 *
 * What shipped was eleven characters: a dictionary word and three digits. A
 * single captured token plus hashcat recovers that on a laptop in minutes.
 * The process now refuses to start rather than serving requests it cannot
 * actually authenticate. The old value is not repeated anywhere in this
 * repository — it is live until it is rotated.
 */

const MIN_SECRET_LENGTH = 32;

const GENERATE_HINT =
  "  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

/**
 * There is deliberately no list of known-bad values here. Writing the secret
 * this replaced into the source would put it in git history permanently — and
 * every weak value worth naming is short, so the length check below already
 * rejects all of them.
 */
function assertUsableSecret(secret) {
  if (!secret) {
    throw new Error(`JWT_SECRET is not set. Generate one with:\n${GENERATE_HINT}`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is ${secret.length} characters; at least ${MIN_SECRET_LENGTH} are required. ` +
        `A short HMAC secret is brute-forceable offline from one captured token.`,
    );
  }
}

// Checked at require time, so a misconfigured deployment fails at boot with a
// clear message instead of authenticating everybody with a guessable key.
assertUsableSecret(process.env.JWT_SECRET);

const JWT_CONFIG = {
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  algorithm: 'HS256',
};

const generateToken = (walletAddress) => {
  return jwt.sign({ walletAddress }, JWT_CONFIG.secret, {
    expiresIn: JWT_CONFIG.expiresIn,
    algorithm: JWT_CONFIG.algorithm,
  });
};

const verifyToken = (token) => {
  try {
    // The algorithm is pinned. Without this, verification accepts whatever the
    // token's own header asks for, which is the shape of every historical JWT
    // confusion attack.
    return jwt.verify(token, JWT_CONFIG.secret, {
      algorithms: [JWT_CONFIG.algorithm],
    });
  } catch (error) {
    throw new Error('Invalid token');
  }
};

module.exports = {
  generateToken,
  verifyToken,
  assertUsableSecret,
  JWT_CONFIG,
};
