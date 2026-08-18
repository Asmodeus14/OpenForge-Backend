-- Link a room to whatever created it.
--
-- An opaque key, e.g. 'escrow:0xabc...:dispute'. The server never interprets
-- it — it stores it and hands it back. Clients previously had to find their
-- own rooms by matching the display name, which silently breaks the moment
-- anyone renames a room.
--
-- Nullable, so every existing room and every caller that does not set it
-- keeps working unchanged.

ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS context VARCHAR(200);

-- Looking a room up by its context is the whole point of the column.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_chat_rooms_context') THEN
        CREATE INDEX idx_chat_rooms_context ON chat_rooms(context);
    END IF;
END $$;
