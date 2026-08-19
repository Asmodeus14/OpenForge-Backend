const { Pool } = require('pg');
require('dotenv').config();

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon serves a certificate from a public CA, so validation succeeds.
      // This was `rejectUnauthorized: false`, which silently cancelled the
      // `sslmode=require&channel_binding=require` in the connection string and
      // let anything between the app and the database present a self-signed
      // certificate and read every query and credential in transit.
      ssl: true,
      max: 20,
      // Opening a connection to Neon costs a TLS handshake — measured at
      // ~160ms, against ~90ms for a query on an established one. At 30s this
      // app, which is idle most of the time, paid that on nearly every
      // request. Sixty seconds spans a burst of user activity instead.
      idleTimeoutMillis: 60000,
      // Keeps the socket alive through NAT and Neon's idle handling, so a
      // pooled connection is less likely to be dead when it is next borrowed.
      keepAlive: true,
      // A suspended Neon instance takes several seconds to wake, and a free
      // Render dyno wakes at the same moment. Two seconds guaranteed a failed
      // first connection, and `connect()` exits the process on failure — so
      // the app crash-looped itself awake instead of waiting.
      connectionTimeoutMillis: 10000,
      // A single unbounded query could otherwise hold a connection forever.
      statement_timeout: 15000,
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected database error', err);
    });
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      // Gated: this logged the full SQL of every query on every request, which
      // on a free tier is enormous volume and publishes the complete schema
      // and query shapes to anyone with log access. Slow queries are still
      // reported in production, because those are worth knowing about.
      if (process.env.NODE_ENV !== 'production') {
        console.log('Executed query', { text, duration, rows: res.rowCount });
      } else if (duration > 1000) {
        console.warn('Slow query', { duration, rows: res.rowCount });
      }
      return res;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      console.log('Database connected successfully');
      client.release();
    } catch (error) {
      console.error('Database connection failed:', error);
      process.exit(1);
    }
  }
}

module.exports = new Database();