const fs = require('fs').promises;
const path = require('path');
const db = require('../config/db');

async function runMigrations() {
  try {
    console.log('Starting database migrations...');
    
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Check if migrations directory exists
    try {
      await fs.access(migrationsDir);
    } catch (error) {
      console.error('Migrations directory not found:', error.message);
      console.log('Creating migrations directory...');
      await fs.mkdir(migrationsDir, { recursive: true });
      console.log('Please add migration files to src/db/migrations/');
      process.exit(1);
    }
    
    const files = await fs.readdir(migrationsDir);
    
    // Sort files numerically
    const sortedFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => {
        const numA = parseInt(a.split('_')[0]) || 0;
        const numB = parseInt(b.split('_')[0]) || 0;
        return numA - numB;
      });
    
    if (sortedFiles.length === 0) {
      console.log('No migration files found in', migrationsDir);
      console.log('Creating initial migration files...');
      await createInitialMigrations(migrationsDir);
      
      // Read files again
      const newFiles = await fs.readdir(migrationsDir);
      const newSortedFiles = newFiles
        .filter(f => f.endsWith('.sql'))
        .sort((a, b) => {
          const numA = parseInt(a.split('_')[0]) || 0;
          const numB = parseInt(b.split('_')[0]) || 0;
          return numA - numB;
        });
      
      for (const file of newSortedFiles) {
        console.log(`Running migration: ${file}`);
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        await db.query(sql);
        console.log(`✓ Migration ${file} completed`);
      }
    } else {
      for (const file of sortedFiles) {
        console.log(`Running migration: ${file}`);
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
        await db.query(sql);
        console.log(`✓ Migration ${file} completed`);
      }
    }
    
    console.log('✅ All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

async function createInitialMigrations(migrationsDir) {
  // Create 001_create_tables.sql
  const migration1 = `-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (wallet-based)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(42) UNIQUE NOT NULL,
    nonce VARCHAR(100) NOT NULL DEFAULT floor(random() * 1000000)::text,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE
);

-- Chat rooms table
CREATE TABLE IF NOT EXISTS chat_rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    room_type VARCHAR(20) NOT NULL CHECK (room_type IN ('public', 'private', 'p2p')),
    admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Room members table with request status for public rooms
CREATE TABLE IF NOT EXISTS room_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'left')),
    is_admin BOOLEAN DEFAULT false,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    is_edited BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Message reactions table
CREATE TABLE IF NOT EXISTS message_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) DEFAULT 'like',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id, reaction_type)
);

-- Room invitations table
CREATE TABLE IF NOT EXISTS room_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_id UUID REFERENCES chat_rooms(id) ON DELETE CASCADE,
    inviter_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invitee_wallet_address VARCHAR(42) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '7 days')
);

-- Create indexes for better performance
DO $$ 
BEGIN
    -- Users indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_wallet') THEN
        CREATE INDEX idx_users_wallet ON users(wallet_address);
    END IF;
    
    -- Room members indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_room_members_user') THEN
        CREATE INDEX idx_room_members_user ON room_members(user_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_room_members_room') THEN
        CREATE INDEX idx_room_members_room ON room_members(room_id);
    END IF;
    
    -- Messages indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_messages_room') THEN
        CREATE INDEX idx_messages_room ON messages(room_id, created_at);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_messages_sender') THEN
        CREATE INDEX idx_messages_sender ON messages(sender_id);
    END IF;
    
    -- Message likes indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_message_likes_message') THEN
        CREATE INDEX idx_message_likes_message ON message_likes(message_id);
    END IF;
    
    -- Room invitations indexes
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_room_invitations_invitee') THEN
        CREATE INDEX idx_room_invitations_invitee ON room_invitations(invitee_wallet_address);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_room_invitations_room') THEN
        CREATE INDEX idx_room_invitations_room ON room_invitations(room_id);
    END IF;
END $$;`;

  // Create 002_create_functions_triggers.sql
  const migration2 = `-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_chat_rooms_updated_at ON chat_rooms;
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_rooms_updated_at 
    BEFORE UPDATE ON chat_rooms 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at 
    BEFORE UPDATE ON messages 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to handle P2P room creation
CREATE OR REPLACE FUNCTION create_or_get_p2p_room(
    wallet1 VARCHAR(42),
    wallet2 VARCHAR(42)
)
RETURNS UUID AS $$
DECLARE
    user1_id UUID;
    user2_id UUID;
    room_id UUID;
    room_name VARCHAR(100);
BEGIN
    -- Get or create users
    INSERT INTO users (wallet_address) 
    VALUES (wallet1), (wallet2)
    ON CONFLICT (wallet_address) DO NOTHING;
    
    SELECT id INTO user1_id FROM users WHERE wallet_address = wallet1;
    SELECT id INTO user2_id FROM users WHERE wallet_address = wallet2;
    
    -- Check if P2P room already exists
    SELECT cr.id INTO room_id
    FROM chat_rooms cr
    JOIN room_members rm1 ON cr.id = rm1.room_id
    JOIN room_members rm2 ON cr.id = rm2.room_id
    WHERE cr.room_type = 'p2p'
    AND rm1.user_id = user1_id
    AND rm2.user_id = user2_id
    AND cr.is_active = true
    LIMIT 1;
    
    IF room_id IS NULL THEN
        room_name := CONCAT('P2P: ', LEFT(wallet1, 6), '...', RIGHT(wallet1, 4), ' - ', LEFT(wallet2, 6), '...', RIGHT(wallet2, 4));
        
        INSERT INTO chat_rooms (name, room_type, admin_id)
        VALUES (room_name, 'p2p', user1_id)
        RETURNING id INTO room_id;
        
        -- Add both users as members
        INSERT INTO room_members (room_id, user_id, status, is_admin)
        VALUES 
            (room_id, user1_id, 'approved', true),
            (room_id, user2_id, 'approved', false);
    END IF;
    
    RETURN room_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check if user is room admin
CREATE OR REPLACE FUNCTION is_room_admin(
    p_user_id UUID,
    p_room_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM room_members 
        WHERE user_id = p_user_id 
        AND room_id = p_room_id 
        AND is_admin = true
        AND status = 'approved'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get user rooms with metadata
CREATE OR REPLACE FUNCTION get_user_rooms_with_metadata(
    p_user_id UUID
)
RETURNS TABLE(
    room_id UUID,
    room_name VARCHAR,
    room_type VARCHAR,
    description TEXT,
    admin_wallet VARCHAR,
    member_count BIGINT,
    unread_count BIGINT,
    last_message_at TIMESTAMPTZ,
    user_status VARCHAR,
    is_user_admin BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cr.id AS room_id,
        cr.name AS room_name,
        cr.room_type,
        cr.description,
        u.wallet_address AS admin_wallet,
        COUNT(DISTINCT rm2.user_id) AS member_count,
        COUNT(CASE WHEN m.id IS NOT NULL AND (m.created_at > rm.last_seen OR rm.last_seen IS NULL) THEN 1 END) AS unread_count,
        MAX(m.created_at) AS last_message_at,
        rm.status AS user_status,
        rm.is_admin AS is_user_admin
    FROM room_members rm
    JOIN chat_rooms cr ON rm.room_id = cr.id
    JOIN users u ON cr.admin_id = u.id
    LEFT JOIN room_members rm2 ON cr.id = rm2.room_id AND rm2.status = 'approved'
    LEFT JOIN messages m ON cr.id = m.room_id
    WHERE rm.user_id = p_user_id 
    AND rm.status IN ('approved', 'pending')
    AND cr.is_active = true
    GROUP BY cr.id, cr.name, cr.room_type, cr.description, u.wallet_address, rm.status, rm.is_admin
    ORDER BY MAX(m.created_at) DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;`;

  await fs.writeFile(path.join(migrationsDir, '001_create_tables.sql'), migration1);
  await fs.writeFile(path.join(migrationsDir, '002_create_functions_triggers.sql'), migration2);
  
  console.log('✓ Created initial migration files');
}

// Run migrations
runMigrations();