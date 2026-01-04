# Web3 Chat Backend

A production-ready Web3 chat backend with Discord-like rooms, wallet authentication, and real-time messaging using plain SQL (no ORM).

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
- **Database**: PostgreSQL (NeonDB compatible)
- **Driver**: `pg` with `pg-pool` connection pooling
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

## Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd web3-chat-backend
Install dependencies

