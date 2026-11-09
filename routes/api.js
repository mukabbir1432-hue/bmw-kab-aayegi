/* =====================================================================
   BMW KAB AAYEGI? — API ROUTES
   =====================================================================
   File     : routes/api.js
   Version  : 2.0.0
   Purpose  : All API endpoints (public + admin)
   
   STRUCTURE:
   ─────────────────────────────────────────────────────────────────────
   01. Imports
   02. Rate Limiters
   03. Async Handler Wrapper
   04. Admin Authentication Middleware
   05. Public Routes       (see Part 2)
   06. Admin Routes        (see Part 3)
   07. Export
   ===================================================================== */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

/* ---------------------------------------------------------------------
   01. IMPORTS
   --------------------------------------------------------------------- */
const planController = require('../assets/controllers/planController');


/* ---------------------------------------------------------------------
   02. RATE LIMITERS
   ---------------------------------------------------------------------
   Different limits for different route types:
   - Standard: 10 req/min (user actions)
   - Strict:   5 req/min  (write operations)
   - Admin:    30 req/min (admin actions)
   --------------------------------------------------------------------- */

// Standard limiter for read-heavy endpoints
const standardLimiter = rateLimit({
  windowMs: 60 * 1000,                       // 1 minute
  max: 10,                                   // 10 requests per minute
  message: {
    success: false,
    error: 'Too many requests. Please try again in a minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip health checks from rate limiting
  skip: (req) => req.path === '/health',
});

// Strict limiter for write operations (calculate, save-lead, whatsapp)
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,                                    // 5 requests per minute
  message: {
    success: false,
    error: 'Too many submissions. Please wait before trying again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin limiter (more relaxed — admin dashboard polls frequently)
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,                                   // 30 requests per minute
  message: {
    success: false,
    error: 'Too many admin requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});


/* ---------------------------------------------------------------------
   03. ASYNC HANDLER WRAPPER
   ---------------------------------------------------------------------
   Wraps async route handlers so any thrown errors or rejected promises
   are automatically forwarded to Express's error handler.
   Eliminates try-catch boilerplate in every route.
   --------------------------------------------------------------------- */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};


/* ---------------------------------------------------------------------
   04. ADMIN AUTHENTICATION MIDDLEWARE
   ---------------------------------------------------------------------
   Validates admin password from:
   1. X-Admin-Password header (preferred — more secure)
   2. password query parameter (fallback — for backwards compatibility)
   
   On failure: returns 401 Unauthorized.
   --------------------------------------------------------------------- */
const requireAdmin = (req, res, next) => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  // If no admin password is configured, block all admin access
  if (!adminPassword) {
    return res.status(503).json({
      success: false,
      error: 'Admin access is not configured on this server.',
    });
  }

  // Accept password from header OR query string
  const providedPassword =
    req.headers['x-admin-password'] ||
    req.query.password;

  if (!providedPassword || providedPassword !== adminPassword) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Invalid admin password.',
    });
  }

  next();
};
/* ---------------------------------------------------------------------
   05. PUBLIC ROUTES
   --------------------------------------------------------------------- */

/* ---------- Health Check ---------- */
/**
 * GET /api/health
 * Returns server status. Used by load balancers / uptime monitors.
 */
router.get(
  '/health',
  planController.healthCheck
);


/* ---------- Calculate Plan ---------- */
/**
 * POST /api/calculate
 * Body: { name, age, savings, carModel }
 * Returns: { success: true, plan: {...} }
 *
 * Computes EMI, down payment, timeline, target year.
 * All logic is server-side to prevent client manipulation.
 */
router.post(
  '/calculate',
  strictLimiter,
  asyncHandler(planController.calculatePlan)
);


/* ---------- Save Lead ---------- */
/**
 * POST /api/save-lead
 * Body: { name, age, savings, carModel, carPrice, downPayment, emi,
 *         yearsNeeded, targetYear, referrerCode }
 * Returns: { success: true, id }
 *
 * Saves full plan calculation to MongoDB.
 * Fire-and-forget from frontend — errors don't block user flow.
 */
router.post(
  '/save-lead',
  strictLimiter,
  asyncHandler(planController.saveLead)
);


/* ---------- Get Public Stats ---------- */
/**
 * GET /api/stats
 * Returns: { success, totalCalculations, topModels, todayCount }
 *
 * Public aggregate stats shown on homepage.
 */
router.get(
  '/stats',
  standardLimiter,
  asyncHandler(planController.getStats)
);


/* ---------- Track Event ---------- */
/**
 * POST /api/track-event
 * Body: { eventName, carModel }
 * Returns: { success: true, id }
 *
 * Custom analytics — backup for GA4 when blocked by ad blockers.
 */
router.post(
  '/track-event',
  standardLimiter,
  asyncHandler(planController.trackEvent)
);


/* ---------- Save WhatsApp Lead ---------- */
/**
 * POST /api/save-whatsapp-lead
 * Body: { name, phone, carModel, targetYear, savings }
 * Returns: { success: true, id, message }
 *
 * Captures phone number with consent for WhatsApp reminders.
 * Validates phone format (10 digits, Indian mobile).
 */
router.post(
  '/save-whatsapp-lead',
  strictLimiter,
  asyncHandler(planController.saveWhatsAppLead)
);
/* ---------------------------------------------------------------------
   06. ADMIN ROUTES
   ---------------------------------------------------------------------
   All admin routes require the requireAdmin middleware.
   Admin password is validated on every request.
   --------------------------------------------------------------------- */

/* ---------- Get All Analytics Events ---------- */
/**
 * GET /api/admin/events
 * Auth: X-Admin-Password header (or ?password=)
 * Returns: { success, data: [events] }
 *
 * Latest 500 events sorted by timestamp (descending).
 * Used by the admin dashboard.
 */
router.get(
  '/admin/events',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const Event = require('../assets/models/Event');

    const events = await Event
      .find()
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();                                 // lean() = faster, plain JS objects

    return res.status(200).json({
      success: true,
      count: events.length,
      data: events,
    });
  })
);


/* ---------- Get All Leads ---------- */
/**
 * GET /api/admin/leads
 * Auth: X-Admin-Password header (or ?password=)
 * Returns: { success, data: [leads] }
 *
 * Latest 200 leads sorted by createdAt (descending).
 * Used by the admin dashboard.
 */
router.get(
  '/admin/leads',
  adminLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const Plan = require('../assets/models/Plan');

    const leads = await Plan
      .find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      count: leads.length,
      data: leads,
    });
  })
);


/* ---------------------------------------------------------------------
   07. EXPORT
   --------------------------------------------------------------------- */
module.exports = router;