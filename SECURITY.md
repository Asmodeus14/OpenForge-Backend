# Security

## Status of this project

This is the chat backend for **OpenForge**, a prototype on the Sepolia test
network. It has not been audited, has no test suite, and no bug bounty is
offered.

It holds no funds and signs no transactions. What it does hold is private
conversation — including rooms attached to escrow disputes — so the security
that matters here is authentication and room authorisation.

## Reporting a vulnerability

Report privately through GitHub's **Report a vulnerability** button under the
Security tab. Please do not open a public issue for anything exploitable.

Useful reports include the request, the response, and what an attacker gains.
Expect a reply in days rather than hours; no formal window is promised because
none could be honoured reliably.

## The authentication model

A client asks for a nonce, signs it with their wallet (EIP-191
`personal_sign`), and exchanges the signature for a JWT. The wallet address in
the token is the identity for every subsequent request.

Consequences worth stating plainly:

- **The JWT is a bearer token.** Anyone holding it is that wallet, until it
  expires. The frontend stores it in `localStorage`, so any script running on
  the page can read it.
- **It grants messaging access only.** It cannot authorise a transaction, move
  funds, or act on any contract.
- **Rotating `JWT_SECRET` invalidates every issued token**, which is the
  intended way to revoke access.

## Known weaknesses

**Rate limiting is per-IP** — 100 requests per 15 minutes generally, 20 for
nonce issuance and signature verification. Trivially bypassed by distributing
across addresses. It exists to bound accidental load and casual abuse, not a
determined attacker.

**The nonce endpoint is unauthenticated and writes a row per call.** The
tighter limiter on it is the only thing bounding that.

**Message content is not encrypted.** It is stored in plain text and readable
by anyone with database access, including the hosting provider. Do not put
anything in a room that would matter if the database leaked.

**Room membership is the whole confidentiality model.** Reads require
*approved* membership. A bug that accepts `pending` instead exposes full room
history to anyone who can list public rooms and click join — that exact bug
existed and was fixed; it is the failure mode to watch for in any new endpoint.

**Deleted messages are deleted, not redacted.** There is no audit trail.

## If you are running your own deployment

- Generate a fresh `JWT_SECRET`. Never reuse one from an example file.
- Set `CORS_ORIGIN` to your exact origins **including the scheme**. An entry
  without `http://` or `https://` can never match an `Origin` header, and the
  resulting failure looks exactly like the server being down.
- Restrict database access to the application. The connection string is the
  most valuable secret here.
- Rotate any credential that has appeared in a commit, a log or a screenshot.
