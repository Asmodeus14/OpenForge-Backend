-- Indexes for access patterns the original set did not cover.
--
-- On today's data (30 users, 37 messages) none of these change a plan: at this
-- size Postgres correctly prefers a sequential scan and every query executes in
-- under 1.5ms. They are here because the queries that need them are the ones
-- that grow without bound, and because two of them back foreign keys, which
-- also makes cascading deletes cheap.
--
-- IF NOT EXISTS throughout so this is safe to re-run.

-- `getRoomMessagesWithLikes` tests `user_id` in an EXISTS subquery per message.
-- EXPLAIN showed a sequential scan on message_likes: the only existing index
-- leads with message_id, which that predicate cannot use.
CREATE INDEX IF NOT EXISTS idx_message_likes_user ON message_likes(user_id);

-- Every membership and admin check filters room + status together, as does
-- getRoomMembers and getPendingRequests. idx_room_members_room stops at room.
CREATE INDEX IF NOT EXISTS idx_room_members_room_status ON room_members(room_id, status);

-- getUserRooms: the user's rooms, filtered by status.
CREATE INDEX IF NOT EXISTS idx_room_members_user_status ON room_members(user_id, status);

-- messages.parent_message_id is a foreign key with no index, so threaded reply
-- lookups scan, and ON DELETE SET NULL scans the whole table per deleted row.
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- getPublicRooms: the public, active rooms, newest first. Partial, because
-- inactive and non-public rooms are never listed by this path.
CREATE INDEX IF NOT EXISTS idx_chat_rooms_public_recent
  ON chat_rooms(created_at DESC)
  WHERE is_active AND room_type = 'public';

-- room_invitations is filtered by invitee and status together on every
-- pending-invitation lookup.
CREATE INDEX IF NOT EXISTS idx_room_invitations_invitee_status
  ON room_invitations(invitee_wallet_address, status);
