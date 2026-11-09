/* =====================================================================
   BMW KAB AAYEGI? — EVENT MODEL
   =====================================================================
   File     : models/Event.js
   Version  : 3.0.0
   Purpose  : Frontend analytics events (backup for GA4 when blocked)
   
   CONNECTIONS
   ─────────────────────────────────────────────────────────────────────
   • controllers/planController.js → trackEvent() se create hota
   • routes/api.js                → POST /api/track-event
   • routes/api.js                → GET  /api/admin/events
   • admin.html                   → dashboard stats from events
   
   FIELDS
   ─────────────────────────────────────────────────────────────────────
   • eventName  → e.g., "form_start", "result_view"
   • carModel   → optional context (e.g., "X1")
   • timestamp  → when event fired (default: now)
   • ipAddress  → hashed for privacy (one-way, 64 chars max for IPv6)
   • userAgent  → browser info (truncated to 200 chars)
   • source     → website | admin | import | api
   • metadata   → optional free-form data (future-proof)
   ===================================================================== */

'use strict';

const mongoose = require('mongoose');


/* ---------------------------------------------------------------------
   01. CONSTANTS
   --------------------------------------------------------------------- */

/**
 * Known event names — kept for reference and validation hints.
 * NOT enforced as enum (frontend may add new events faster).
 */
const VALID_EVENT_NAMES = Object.freeze([
  'form_start',
  'calculate_click',
  'result_view',
  'whatsapp_share',
  'whatsapp_lead_save',
  'affiliate_click',
  'referral_visit',
  'referral_copy',
  'reset_click',
  'delivery_form_submit',
]);

/**
 * Valid sources — MUST match models/Plan.js VALID_SOURCES.
 */
const VALID_SOURCES = Object.freeze([
  'website',
  'admin',
  'import',
  'api',
]);

// Field size limits (kept as constants for consistency)
const LIMITS = Object.freeze({
  EVENT_NAME: 50,
  CAR_MODEL: 50,
  IP_ADDRESS: 64, // IPv6 max = 45, buffer for hashed versions
  USER_AGENT: 200,
  SOURCE: 50,
});


/* ---------------------------------------------------------------------
   02. SCHEMA — CORE FIELDS
   --------------------------------------------------------------------- */
const EventsSchema = new mongoose.Schema(
  {
    /* ---------- Event identity ---------- */
    eventName: {
      type: String,
      required: [true, 'Event name is required'],
      trim: true,
      maxlength: [LIMITS.EVENT_NAME, 'Event name cannot exceed ' + LIMITS.EVENT_NAME + ' characters'],
      // NOTE: not enum-restricted — frontend controls what's tracked
    },
    carModel: {
      type: String,
      trim: true,
      maxlength: [LIMITS.CAR_MODEL, 'Car model cannot exceed ' + LIMITS.CAR_MODEL + ' characters'],
    },

    /* ---------- Timing ---------- */
    timestamp: {
      type: Date,
      default: Date.now,
      index: true, // covered by compound indexes below, explicit for clarity
    },

    /* ---------- Client info (privacy-safe) ---------- */
    ipAddress: {
      type: String,
      trim: true,
      maxlength: [LIMITS.IP_ADDRESS, 'IP address too long'],
      // NOTE: stored HASHED (one-way) by controller — never raw
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: [LIMITS.USER_AGENT, 'User agent too long'],
    },
        /* ---------- Metadata ---------- */
    source: {
      type: String,
      default: 'website',
      trim: true,
      enum: {
        values: VALID_SOURCES,
        message: '"{VALUE}" is not a valid source',
      },
      maxlength: [LIMITS.SOURCE, 'Source too long'],
    },
    // Free-form extra data (referral code, partner name, etc.)
    // Kept as Mixed so new fields don't require schema migration.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined, // don't store empty object — saves bytes
    },
  },
  {
    /* =================================================================
       03. SCHEMA-LEVEL OPTIONS
       =============================================================== */
    timestamps: true,      // auto createdAt + updatedAt
    versionKey: false,     // remove __v from responses
    minimize: true,        // remove empty objects automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);


/* ---------------------------------------------------------------------
   04. INDEXES
   ---------------------------------------------------------------------
   Compound indexes ordered by selectivity (most specific first).
   Single-field indexes on timestamp are covered by compounds.
   --------------------------------------------------------------------- */

// Recent events (admin dashboard — most common query)
EventsSchema.index({ timestamp: -1 }, { name: 'idx_recent_events' });

// Event type filtering (funnels, aggregations)
EventsSchema.index(
  { eventName: 1, timestamp: -1 },
  { name: 'idx_event_by_time' }
);

// Car model analytics (top shared/viewed models)
EventsSchema.index(
  { carModel: 1, timestamp: -1 },
  { sparse: true, name: 'idx_car_model_by_time' }
);

// Source filtering (website vs admin vs import)
EventsSchema.index(
  { source: 1, timestamp: -1 },
  { name: 'idx_source_by_time' }
);
/* ---------------------------------------------------------------------
   05. VIRTUALS (computed, not stored)
   --------------------------------------------------------------------- */

/**
 * Is this a conversion event? (share, lead save, affiliate click)
 */
EventsSchema.virtual('isConversion').get(function () {
  return [
    'whatsapp_share',
    'whatsapp_lead_save',
    'affiliate_click',
  ].indexOf(this.eventName) !== -1;
});

/**
 * Age of this event in seconds. Useful for "recent" filtering.
 */
EventsSchema.virtual('ageSeconds').get(function () {
  if (!this.timestamp) return null;
  return Math.floor((Date.now() - this.timestamp.getTime()) / 1000);
});

/**
 * Safe summary (no IP, no UA) — for public/admin table display.
 */
EventsSchema.virtual('publicSummary').get(function () {
  return {
    id: this._id,
    eventName: this.eventName,
    carModel: this.carModel || null,
    timestamp: this.timestamp,
    source: this.source,
  };
});


/* ---------------------------------------------------------------------
   06. STATIC METHODS
   --------------------------------------------------------------------- */

/**
 * Count events grouped by name, optionally within a date range.
 *
 * @param {Date} [start] - range start (inclusive)
 * @param {Date} [end]   - range end (inclusive)
 * @returns {Promise<Array>} [{ eventName, count }]
 */
EventsSchema.statics.countByName = function (start, end) {
  const match = {};
  if (start || end) {
    match.timestamp = {};
    if (start) match.timestamp.$gte = start;
    if (end) match.timestamp.$lte = end;
  }

  return this.aggregate([
    { $match: match },
    { $group: { _id: '$eventName', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, eventName: '$_id', count: 1 } },
  ]);
};

/**
 * Get top car models by view count, optionally within a date range.
 *
 * @param {Date} [start]
 * @param {Date} [end]
 * @param {number} [limit=5]
 * @returns {Promise<Array>} [{ carModel, count }]
 */
EventsSchema.statics.topCarModels = function (start, end, limit) {
  const match = {
    carModel: { $exists: true, $nin: [null, ''] },
  };
  if (start || end) {
    match.timestamp = {};
    if (start) match.timestamp.$gte = start;
    if (end) match.timestamp.$lte = end;
  }

  const lim = Math.min(limit || 5, 50);

  return this.aggregate([
    { $match: match },
    { $group: { _id: '$carModel', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: lim },
    { $project: { _id: 0, carModel: '$_id', count: 1 } },
  ]);
};

/**
 * Get a full event summary for the admin dashboard.
 * Returns everything the dashboard needs in one round-trip.
 *
 * @param {number} [days=7] - lookback window
 * @returns {Promise<Object>}
 */
EventsSchema.statics.getDashboardStats = async function (days) {
  const d = Math.max(1, Math.min(days || 7, 90));
  const now = new Date();
  const start = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [total, today, byName, topModels] = await Promise.all([
    this.countDocuments({ timestamp: { $gte: start } }),
    this.countDocuments({ timestamp: { $gte: todayStart } }),
    this.countByName(start, now),
    this.topCarModels(start, now, 5),
  ]);

  return { total, today, byName, topModels, windowDays: d };
};

/**
 * Delete events older than N days (for scheduled cleanup job).
 *
 * @param {number} [days=90]
 * @returns {Promise<{deletedCount}>}
 */
EventsSchema.statics.deleteOlderThan = function (days) {
  const d = Math.max(1, days || 90);
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  return this.deleteMany({ timestamp: { $lt: cutoff } });
};
/* ---------------------------------------------------------------------
   07. HOOKS
   --------------------------------------------------------------------- */

/**
 * Pre-validate: normalize and truncate string fields.
 * This protects against malicious/broken payloads that bypass
 * Mongoose's maxlength (e.g., direct DB writes).
 */
EventsSchema.pre('validate', function (next) {
  if (this.eventName) {
    this.eventName = String(this.eventName).trim().slice(0, LIMITS.EVENT_NAME);
  }
  if (this.carModel) {
    this.carModel = String(this.carModel).trim().slice(0, LIMITS.CAR_MODEL);
  }
  if (this.userAgent) {
    this.userAgent = String(this.userAgent).trim().slice(0, LIMITS.USER_AGENT);
  }
  if (this.ipAddress) {
    this.ipAddress = String(this.ipAddress).trim().slice(0, LIMITS.IP_ADDRESS);
  }
  next();
});

/**
 * Post-save: log in development only (avoid production noise).
 */
EventsSchema.post('save', function (doc) {
  if (process.env.NODE_ENV !== 'production') {
    const model = doc.carModel ? ' → ' + doc.carModel : '';
    console.log('[EVENT] ' + doc.eventName + model);
  }
});


/* ---------------------------------------------------------------------
   08. EXPORT
   --------------------------------------------------------------------- */
module.exports = mongoose.model('Event', EventsSchema);