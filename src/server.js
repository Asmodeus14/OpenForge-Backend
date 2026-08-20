require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');


// Database
const db = require('./config/db');

// CORS
const { allowedOrigins, isAllowedOrigin } = require('./config/cors');

// Routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const invitationRoutes = require('./routes/invitations');

// Socket service
const SocketService = require('./services/socket');

const app = express();
const server = http.createServer(app);

// Render terminates TLS at its proxy, so without this every request arrives
// carrying the proxy's address. express-rate-limit keys on req.ip, so all
// users shared ONE bucket: the whole API allowed 100 requests per 15 minutes
// between everybody, and a single client could lock every other user out.
// One hop, because that is what Render puts in front of the app — trusting
// every hop would let a caller spoof X-Forwarded-For and evade the limit.
app.set('trust proxy', 1);

// A rejected promise anywhere outside an Express handler used to take the
// process down silently. The socket layer produced exactly that on every
// recovered reconnect. Logging and staying up is the right trade for a chat
// server: the alternative is every connected user losing their session.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Message and room listings are repetitive JSON — wallet addresses, ISO
// timestamps and UUIDs — which is exactly what gzip is good at. Clients reach
// this over the open internet from a free Render dyno, so bytes on the wire
// cost more than the compression does. Before the routes, so it wraps them.
app.use(compression());

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);

    // A refused origin still gets a normal response, just without the
    // Access-Control-Allow-Origin header — so the server sees a clean 200
    // while the browser discards it and reports only a generic network
    // failure. Logging it is the difference between a five-minute fix and an
    // afternoon of guessing.
    console.warn(
      `[cors] refused origin ${origin} — allowed: ${allowedOrigins.join(', ') || '(none)'}`,
    );
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || 100),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Signature verification and nonce issuance get their own, much tighter
// budget. They shared the general one, so an attacker grinding nonces or
// brute-forcing signatures consumed exactly the same allowance as somebody
// reading their messages — and the nonce endpoint is unauthenticated and
// creates a database row on every call.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Wait a few minutes and try again.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/nonce', authLimiter);
app.use('/api/auth/verify', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'web3-chat-backend'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api', messageRoutes);
app.use('/api/invitations', invitationRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  const statusCode = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize Socket.IO
const socketService = new SocketService(server);

// Database connection and server start
async function startServer() {
  try {
    // Test database connection
    await db.connect();
    console.log('✅ Database connected successfully');

    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready`);
      console.log(`🔗 CORS enabled for: ${allowedOrigins.join(', ')}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  console.log('🛑 Received shutdown signal');
  
  try {
    // Close HTTP server
    server.close(async () => {
      console.log('✅ HTTP server closed');
      
      // Close database pool
      await db.pool?.end();
      console.log('✅ Database connections closed');
      
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.log('⏰ Forcing shutdown after timeout');
      process.exit(1);
    }, 10000);

  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

startServer();

module.exports = { app, server };