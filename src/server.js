require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');


// Database
const db = require('./config/db');

// Routes
const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const invitationRoutes = require('./routes/invitations');

// Socket service
const SocketService = require('./services/socket');

const app = express();
const server = http.createServer(app);

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

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
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
      console.log(`🔗 CORS enabled for: ${corsOptions.origin}`);
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