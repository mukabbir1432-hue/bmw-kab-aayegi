/* =====================================================================
   BMW KAB AAYEGI? — DATABASE CONNECTION
   =====================================================================
   File     : config/db.js
   Version  : 2.0.0
   Purpose  : MongoDB connection (Mongoose) with pooling + retry logic
   
   Connections:
   ─────────────────────────────────────────────────────────────────────
   • server.js → startServer() mein await connectDB() call karta
   • server.js → graceful shutdown mein mongoose.connection.close() karta
   • All models → mongoose.model() yeh connection use karte hain
   
   Features:
   ─────────────────────────────────────────────────────────────────────
   • Connection pooling (maxPoolSize)
   • Auto-retry on failure (3 attempts, exponential backoff)
   • Event listeners (connected, disconnected, error, reconnected)
   • Env validation (fail-fast if MONGODB_URI missing)
   • Silent logger in production (no console noise)
   ===================================================================== */

const mongoose = require('mongoose');


/* ---------------------------------------------------------------------
   01. ENVIRONMENT VALIDATION
   --------------------------------------------------------------------- */
if (!process.env.MONGODB_URI) {
  console.error('❌ FATAL: MONGODB_URI environment variable is not set.');
  console.error('👉 Add MONGODB_URI to your .env file.');
  process.exit(1);
}


/* ---------------------------------------------------------------------
   02. LOGGER ABSTRACTION
   ---------------------------------------------------------------------
   Why not Pino directly?
   - config/db.js is loaded BEFORE server.js sets up Pino
   - If we require Pino here, we create a dependency cycle
   - Solution: console for now; server.js will override via callback
   --------------------------------------------------------------------- */
const isProduction = process.env.NODE_ENV === 'production';

const log = {
  info: (msg) => {
    if (!isProduction) console.log(`[DB] ✅ ${msg}`);
  },
  warn: (msg) => {
    console.warn(`[DB] ⚠️  ${msg}`);
  },
  error: (msg, err) => {
    console.error(`[DB] ❌ ${msg}`, err?.message || '');
  },
};


/* ---------------------------------------------------------------------
   03. CONFIGURATION
   --------------------------------------------------------------------- */
const DB_CONFIG = {
  // Connection pool — how many concurrent operations
  maxPoolSize: 10,

  // Don't wait more than 5s for server selection (fail-fast)
  serverSelectionTimeoutMS: 5000,

  // Close idle sockets after 45s
  socketTimeoutMS: 45000,

  // Connect timeout
  connectTimeoutMS: 10000,

  // Retry writes once on transient failure
  retryWrites: true,

  // Retry reads once on transient failure
  retryReads: true,

  // Use UTC everywhere (avoid timezone bugs in targetYear calculations)
  // Note: Mongoose stores dates in UTC by default; this is for reads
  // (no direct Mongoose option — handled by app code if needed)
};

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
/* ---------------------------------------------------------------------
   04. CONNECT FUNCTION
   ---------------------------------------------------------------------
   Called from server.js startServer().
   Retries up to 3 times with 5s delay between attempts.
   Throws if all retries fail (server.js catches and exits).
   --------------------------------------------------------------------- */

/**
 * Connect to MongoDB with retry logic.
 *
 * @returns {Promise<mongoose.Connection>} Mongoose connection
 * @throws {Error} If connection fails after all retries
 */
const connectDB = async () => {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.info(`Connecting to MongoDB (attempt ${attempt}/${MAX_RETRIES})...`);

      const conn = await mongoose.connect(process.env.MONGODB_URI, DB_CONFIG);

      log.info(`MongoDB connected: ${conn.connection.host}:${conn.connection.port}`);
      log.info(`Database: ${conn.connection.name}`);

      return conn;
    } catch (error) {
      lastError = error;
      log.error(`Connection attempt ${attempt}/${MAX_RETRIES} failed`, error);

      // Don't sleep after last attempt
      if (attempt < MAX_RETRIES) {
        log.warn(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  // All retries failed
  log.error(`All ${MAX_RETRIES} connection attempts failed. Giving up.`);
  throw lastError;
};
/* ---------------------------------------------------------------------
   05. CONNECTION EVENT LISTENERS
   ---------------------------------------------------------------------
   These run AFTER initial connection (server.js already connected).
   Handles disconnections, reconnections, and errors at runtime.
   --------------------------------------------------------------------- */

/**
 * Helper to register connection event listeners.
 * Called once after connectDB() succeeds.
 */
const registerConnectionEvents = () => {
  const connection = mongoose.connection;

  // Connected (initial)
  connection.on('connected', () => {
    log.info('Mongoose default connection is open');
  });

  // Disconnected (network issue, server restart, etc.)
  connection.on('disconnected', () => {
    log.warn('Mongoose connection disconnected — will auto-retry');
  });

  // Reconnected (after disconnect)
  connection.on('reconnected', () => {
    log.info('Mongoose reconnected successfully');
  });

  // Connection error (after initial connect)
  connection.on('error', (error) => {
    log.error('Mongoose connection error', error);
  });

  // Process-level: attempt to close gracefully on app exit
  process.on('SIGINT', async () => {
    try {
      await connection.close();
      log.info('Mongoose connection closed due to app termination');
      process.exit(0);
    } catch (err) {
      log.error('Error closing Mongoose connection', err);
      process.exit(1);
    }
  });
};


/* ---------------------------------------------------------------------
   06. HELPER FUNCTIONS (for admin/debug endpoints)
   --------------------------------------------------------------------- */

/**
 * Get the current connection state as a human-readable string.
 * Useful for health check endpoints.
 *
 * @returns {string} "connected" | "connecting" | "disconnecting" | "disconnected"
 */
const getConnectionState = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
    99: 'uninitialized',
  };
  return states[mongoose.connection.readyState] || 'unknown';
};

/**
 * Gracefully close the connection.
 * Used by server.js during shutdown.
 *
 * @param {boolean} force - if true, don't wait for in-flight ops
 * @returns {Promise<void>}
 */
const closeConnection = async (force = false) => {
  try {
    await mongoose.connection.close(force);
    log.info('Mongoose connection closed');
  } catch (err) {
    log.error('Error closing Mongoose connection', err);
    throw err;
  }
};


/* ---------------------------------------------------------------------
   07. EXPORTS
   --------------------------------------------------------------------- */

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.closeConnection = closeConnection;
module.exports.getConnectionState = getConnectionState;
module.exports.registerConnectionEvents = registerConnectionEvents;