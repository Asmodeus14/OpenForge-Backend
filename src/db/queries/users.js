const db = require('../../config/db');

/**
 * Short-lived cache of the row `authenticateToken` needs.
 *
 * Every authenticated request re-read the user row to turn the wallet address
 * in the JWT into a user id. That is one network round trip to Neon —
 * measured at ~90ms, against 0.04ms of actual query execution — on all 29
 * endpoints, before any of them do their own work.
 *
 * Safe to cache because nothing authentication depends on can change: `id`
 * and `wallet_address` are immutable, there is no delete-user path, and the
 * only mutable columns are `nonce` and `last_login`, which the token check
 * never reads. Both writers below still evict, so no caller can observe a
 * stale nonce.
 *
 * Keyed on the address exactly as given, matching the SQL comparison, so
 * case-handling behaviour is unchanged.
 */
const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 500;
const authCache = new Map();

function cacheGet(walletAddress) {
  const hit = authCache.get(walletAddress);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    authCache.delete(walletAddress);
    return null;
  }
  return hit.row;
}

function cacheSet(walletAddress, row) {
  // Bounded: evict the oldest entry rather than growing without limit.
  if (authCache.size >= AUTH_CACHE_MAX) {
    authCache.delete(authCache.keys().next().value);
  }
  authCache.set(walletAddress, { row, expires: Date.now() + AUTH_CACHE_TTL_MS });
}

/** Drops every casing variant of an address, since keys are stored verbatim. */
function cacheEvict(walletAddress) {
  const target = String(walletAddress).toLowerCase();
  for (const key of authCache.keys()) {
    if (key.toLowerCase() === target) authCache.delete(key);
  }
}

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
    const result = await db.query(query, [walletAddress, nonce]);
    cacheEvict(walletAddress);
    return result;
  },

  getUserByWallet: async (walletAddress) => {
    const query = 'SELECT * FROM users WHERE wallet_address = $1';
    return await db.query(query, [walletAddress]);
  },

  /**
   * `getUserByWallet` for the token check, served from cache when possible.
   * Returns the row, or null — not a pg result — because callers of a cache
   * should not be handed something that looks like a fresh query.
   */
  getUserForAuth: async (walletAddress) => {
    const cached = cacheGet(walletAddress);
    if (cached) return cached;

    const result = await db.query(
      'SELECT * FROM users WHERE wallet_address = $1',
      [walletAddress],
    );
    const row = result.rows[0] ?? null;
    // Absence is deliberately not cached: a user who signs up moments later
    // would otherwise be rejected for the rest of the TTL.
    if (row) cacheSet(walletAddress, row);
    return row;
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
    const result = await db.query(query, [walletAddress, nonce]);
    cacheEvict(walletAddress);
    return result;
  }
};

module.exports = UserQueries;