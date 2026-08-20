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

// An Origin header is always scheme + host + port. An entry written as
// `example.com` or `localhost:3000` therefore matches nothing, ever, and looks
// entirely correct in a log line — which is exactly how it costs an evening.
// The scheme is not guessed, because http and https are different origins and
// picking one silently would trade a loud failure for a quiet one.
const schemeless = allowedOrigins.filter((origin) => !/^https?:\/\//i.test(origin));
if (schemeless.length) {
  console.warn(
    `[cors] these CORS_ORIGIN entries have no http:// or https:// and will never match: ${schemeless.join(', ')}`,
  );
}

/** True for origins on the list, and for callers that send no Origin at all. */
function isAllowedOrigin(origin) {
  // curl, server-to-server, Render's health check. Not subject to the
  // same-origin policy, so there is nothing to enforce.
  if (!origin) return true;
  return allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

module.exports = { allowedOrigins, isAllowedOrigin };
