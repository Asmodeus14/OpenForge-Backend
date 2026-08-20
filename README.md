# OpenForge — chat backend

Wallet-authenticated chat with Discord-like rooms and real-time messaging,
using plain SQL and no ORM.

This is the messaging service for [OpenForge](https://github.com/Asmodeus14/OpenForge),
a milestone-escrow prototype on the Sepolia test network. Rooms can be attached
to an escrow, which is how a funder and a developer talk about a dispute.

**Prototype, not audited.** It holds no funds and signs no transactions, but it
does hold private conversation in plain text. See [SECURITY.md](SECURITY.md).

## Features

- **Wallet Authentication**: EIP-191 `personal_sign` based authentication
- **Room Types**: Public, Private, and P2P (one-to-one) rooms
- **Room Permissions**: Admin controls with join request system for public rooms
- **Real-time Messaging**: Socket.IO powered real-time chat
- **Message Reactions**: Like/unlike messages with real-time updates
- **Typing Indicators**: Real-time typing status
- **Invitation System**: Wallet-based invitations for private rooms

## Tech Stack

- **Runtime**: Node.js + Express
- **Database**: PostgreSQL (Neon compatible), plain SQL via `pg`
- **Real-time**: Socket.IO
- **Authentication**: JWT + EIP-191 signatures

## Database Schema
users
├── wallet_address (unique)
├── nonce (for signing)
└── timestamps

chat_rooms
├── name, description
├── room_type (public/private/p2p)
├── admin_id (references users)
└── timestamps

room_members
├── room_id, user_id (composite unique)
├── status (pending/approved/rejected/left)
├── is_admin
└── timestamps

messages
├── room_id, sender_id
├── content
├── parent_message_id (for replies)
└── timestamps

message_likes
├── message_id, user_id, reaction_type
└── timestamps

room_invitations
├── room_id, inviter_id, invitee_wallet_address
├── status (pending/accepted/rejected)
└── expiration

text

## API Endpoints

### Authentication
- `POST /api/auth/nonce` - Get nonce for wallet
- `POST /api/auth/verify` - Verify signature and get JWT
- `POST /api/auth/refresh` - Refresh JWT token
- `GET /api/auth/me` - Get user profile

### Rooms
- `POST /api/rooms` - Create room
- `GET /api/rooms/public` - Get public rooms
- `GET /api/rooms/my` - Get user's rooms
- `GET /api/rooms/:roomId` - Get room details
- `POST /api/rooms/:roomId/join` - Request to join public room
- `POST /api/rooms/:roomId/invite` - Invite to private room (admin only)
- `GET /api/rooms/:roomId/requests` - Get pending requests (admin only)
- `POST /api/rooms/:roomId/leave` - Leave room
- `DELETE /api/rooms/:roomId` - Delete room (admin only)
- `POST /api/rooms/p2p/:walletAddress` - Create/get P2P room

### Messages
- `GET /api/rooms/:roomId/messages` - Get room messages
- `POST /api/rooms/:roomId/messages` - Send message
- `PUT /api/messages/:messageId` - Edit message
- `DELETE /api/messages/:messageId` - Delete message
- `POST /api/messages/:messageId/like` - Like message
- `DELETE /api/messages/:messageId/like` - Unlike message
- `GET /api/messages/:messageId/likes` - Get message likes

### Invitations
- `GET /api/invitations` - Get user invitations
- `POST /api/invitations/:invitationId/accept` - Accept invitation
- `POST /api/invitations/:invitationId/reject` - Reject invitation

## WebSocket Events

### Client to Server
- `join_room` - Join a room
- `leave_room` - Leave a room
- `send_message` - Send message to room
- `typing` - Typing indicator start
- `typing_stop` - Typing indicator stop
- `like_message` - Like a message
- `unlike_message` - Unlike a message

### Server to Client
- `rooms_joined` - List of joined rooms on connect
- `room_joined` - Room join confirmation
- `room_left` - Room leave confirmation
- `user_joined` - Another user joined room
- `user_left` - Another user left room
- `new_message` - New message in room
- `user_typing` - User typing in room
- `user_typing_stop` - User stopped typing
- `message_liked` - Message liked
- `message_unliked` - Message unliked

### Operations

- `GET /health` — checks the database and reports `healthy` or `unhealthy`.
- `GET /ping` — returns `ok`, touches nothing.

Point an uptime monitor at `/ping`, not `/health`. On a free instance that
sleeps after 15 minutes idle, a 5-minute poll is what stops the first real
request paying a cold start — but polling `/health` runs `SELECT 1` 288 times a
day and holds the database's compute awake around the clock, which exhausts a
free tier faster than sleeping did. `/ping` also sits outside `/api`, so it
never consumes the rate-limit budget real callers share.

---

## Setup

```bash
npm install
cp .env.example .env      # see below
npm run migrate           # applies migrations in filename order
npm run dev               # nodemon, PORT defaults to 5164
```

| Command | Does |
|---|---|
| `npm run dev` | Development server with reload |
| `npm start` | Production server |
| `npm run migrate` | Apply pending migrations |

### Environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string. TLS is required. |
| `JWT_SECRET` | Generate a real one. Rotating it invalidates every issued token. |
| `CORS_ORIGIN` | Comma-separated origins. **Each needs its scheme.** |
| `PORT` | Defaults to 5164. |
| `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX` | Defaults: 15 minutes, 100 requests. |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **`CORS_ORIGIN` needs the scheme on every entry.** An `Origin` header is
> always scheme, host and port, so `localhost:3000` matches nothing while
> `http://localhost:3000` matches. This fails in the most misleading way
> available: the server returns a normal `200` without an
> `Access-Control-Allow-Origin` header, curl sees success, and only the browser
> discards the response — so it presents as the backend being down. The server
> now warns at startup about scheme-less entries and logs every refused origin.

Vercel preview deployments get a new hostname per commit, so each preview
origin needs adding.

### Migrations

Applied in filename order and tracked **by filename, not by content hash**.
Editing an applied migration does not re-run it — deliberate, so comments can
be corrected — which means a schema change needs a new file. Write them to be
safe to run twice.

---

## Documentation

| | |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, conventions, what to check before a PR |
| [SECURITY.md](SECURITY.md) | The auth model, known weaknesses, reporting |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |

## Licence

[MIT](LICENSE).

