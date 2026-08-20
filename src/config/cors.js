/**
 * The one list of browser origins allowed to call this API.
 *
 * Shared by the Express middleware and the Socket.IO server, which previously
 * parsed `CORS_ORIGIN` separately. Both got it wrong the same way, and a
 * deployment could plausibly have fixed one and not the other.
 *
 * Entries are trimmed and stripped of trailing slashes:
 * `CORS_ORIGIN=https://a.example, http://localhost:3000` is the natural way to
 * write a list, and the space made the second entry match nothing.
 *
 * The default is localhost rather than '*'. A wildcard cannot be combined with
 * `credentials: true` — browsers reject that pairing — so '*' was never a
 * working configuration here, only a confusing one.
 */
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

/** True for origins on the list, and for callers that send no Origin at all. */
function isAllowedOrigin(origin) {
  // curl, server-to-server, Render's health check. Not subject to the
  // same-origin policy, so there is nothing to enforce.
  if (!origin) return true;
  return allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

module.exports = { allowedOrigins, isAllowedOrigin };
