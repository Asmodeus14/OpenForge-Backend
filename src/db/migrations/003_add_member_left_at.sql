-- Record when somebody left a room.
--
-- `POST /rooms/:roomId/leave` has always written this column:
--
--     UPDATE room_members SET status = 'left', left_at = NOW() ...
--
-- but no migration ever created it, so every attempt to leave a room failed
-- with `column "left_at" of relation "room_members" does not exist` and a
-- 500. Leaving a room has therefore never worked. The column is added rather
-- than dropped from the query because the handler's intent is right: `status`
-- says somebody left, and this says when.
--
-- Nullable, so every existing membership row is unaffected.

ALTER TABLE room_members ADD COLUMN IF NOT EXISTS left_at TIMESTAMP WITH TIME ZONE;
