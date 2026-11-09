/* =====================================================================
   BMW KAB AAYEGI? — PRODUCTION SERVER
   =====================================================================
   File     : server.js
   Version  : 7.0.0
   Purpose  : Express server entry point
   
   STRUCTURE:
   ─────────────────────────────────────────────────────────────────────
   01. Imports
   02. Environment Validation
   03. Logger Setup (Pino)
   04. Express App Init
   05. Security Middleware
   06. Database Connection (from config/db.js)
   07. Route Mounting       (Part 2)
   08. Error Handlers       (Part 2)
   09. Server Bootstrap     (Part 3)
   10. Graceful Shutdown    (Part 3)
   ===================================================================== */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const pinoHttp = require('pino-http');
const path = require('path');

/* ---------------------------------------------------------------------
   01. IMPORTS (internal)
   --------------------------------------------------------------------- */
const connectDB = require('./config/db');   // ✅ use existing connectDB
const apiRoutes = require('./routes/api');


/* ---------------------------------------------------------------------
   02. ENVIRONMENT VALIDATION
   --------------------------------------------------------------------- */
dotenv.config({ path: path.resolve(__dirname, '.env') });

const requiredEnvVars = ['MONGODB_URI', 'PORT'];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('👉 Add them to your .env file and restart.');
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';


/* ---------------------------------------------------------------------
   03. LOGGER SETUP (Pino)
   ---------------------------------------------------------------------
   Production: JSON logs (machine-readable, for Datadog/CloudWatch/etc.)
   Development: Pretty colored logs (human-readable)
   --------------------------------------------------------------------- */
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  // Only use pino-pretty in development (must be installed as devDependency)
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});


/* ---------------------------------------------------------------------
   04. EXPRESS APP INIT
   --------------------------------------------------------------------- */
const app = express();
app.disable('x-powered-by');

// HTTP request logger
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} → ${res.statusCode}`,
  })
);


/* ---------------------------------------------------------------------
   05. SECURITY MIDDLEWARE
   --------------------------------------------------------------------- */

// A. Helmet — secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// B. CORS — strict allowlist
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  // ❌ Removed localhost:5000 — backend should not call itself
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without origin (Postman, curl, server-to-server)
      if (!origin) return callback(null, true);

      // In development, allow any origin for easier testing
      if (!isProduction) return callback(null, true);

      // In production, strict allowlist
      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password'],
  })
);

// C. Body parsers (10kb limit prevents abuse)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// D. Global rate limit (broad protection)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,          // 15 minutes
  max: isProduction ? 200 : 2000,    // 200 in prod, 2000 in dev
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

app.use('/api', globalLimiter);
/* ---------------------------------------------------------------------
   07. ROUTE MOUNTING
   --------------------------------------------------------------------- */

// API routes
app.use('/api', apiRoutes);

// Root health check (for load balancers)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BMW Kab Aayegi? API is live 🚀',
    environment: process.env.NODE_ENV || 'development',
    version: '7.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});


/* ---------------------------------------------------------------------
   08. ERROR HANDLERS
   --------------------------------------------------------------------- */

// 404 handler
app.use((req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  next(error);
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const statusCode = err.status || (res.statusCode === 200 ? 500 : res.statusCode);

  // Log error (Pino attached as req.log)
  if (req.log) {
    req.log.error({ err, statusCode }, 'Unhandled error');
  } else {
    logger.error({ err, statusCode }, 'Unhandled error');
  }

  // Don't leak sensitive info in production
  const errorMessage = isProduction
    ? statusCode >= 500
      ? 'Internal server error'
      : err.message
    : err.message;

  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    ...(isProduction ? {} : { stack: err.stack }),
  });
});
/* ---------------------------------------------------------------------
   09. SERVER BOOTSTRAP
   --------------------------------------------------------------------- */
const PORT = process.env.PORT || 5000;
let server;

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Start HTTP server
    server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
      logger.info(`🔗 API: http://localhost:${PORT}/api`);
      logger.info(`❤️  Health: http://localhost:${PORT}/api/health`);
    });


    /* -----------------------------------------------------------------
       10. GRACEFUL SHUTDOWN
       -----------------------------------------------------------------
       On SIGTERM or SIGINT:
       1. Stop accepting new connections
       2. Wait for in-flight requests to finish
       3. Close MongoDB connection
       4. Exit process
       
       Force-exit after 10 seconds to prevent hanging.
       --------------------------------------------------------------- */
    const shutdown = async (signal) => {
      logger.warn(`🛑 ${signal} received. Starting graceful shutdown...`);

      // Stop accepting new connections
      server.close(async (err) => {
        if (err) {
          logger.error({ err }, 'Error closing HTTP server');
          process.exit(1);
        }

        logger.info('✅ HTTP server closed');

        try {
          await mongoose.connection.close(false);
          logger.info('✅ MongoDB connection closed');
          process.exit(0);
        } catch (mongoErr) {
          logger.error({ err: mongoErr }, 'Error closing MongoDB');
          process.exit(1);
        }
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        logger.error('⚠️  Forcing shutdown after 10s timeout');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ err: error }, '❌ Fatal error during startup. Exiting.');
    process.exit(1);
  }
};


/* ---------------------------------------------------------------------
   GLOBAL SAFETY NETS
   --------------------------------------------------------------------- */
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled promise rejection. Shutting down.');
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception. Shutting down.');
  process.exit(1);
});


/* ---------------------------------------------------------------------
   START
   --------------------------------------------------------------------- */
startServer();

module.exports = app;