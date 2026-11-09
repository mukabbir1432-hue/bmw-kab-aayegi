/* =====================================================================
   BMW KAB AAYEGI? — WHATSAPP LEAD MODEL
   =====================================================================
   File     : models/WhatsAppLead.js
   Version  : 2.0.0
   Purpose  : Store phone numbers for WhatsApp reminders
   
   Connections:
   ─────────────────────────────────────────────────────────────────────
   • controllers/planController.js → saveWhatsAppLead() se create hota
   • routes/api.js                → /save-whatsapp-lead route
   • Unique phone                 → duplicate leads rokta (11000 error)
   
   Structure:
   ─────────────────────────────────────────────────────────────────────
   01. Imports
   02. Constants
   03. Schema
       03.1. Personal (name, phone)
       03.2. Plan context (carModel, targetYear, savings)
       03.3. Consent
       03.4. Metadata (ipAddress, source)
   04. Schema options
   05. Indexes
   06. Virtuals
   07. Methods
   08. Hooks
   09. Export
   ===================================================================== */

const mongoose = require('mongoose');


/* ---------------------------------------------------------------------
   02. CONSTANTS
   --------------------------------------------------------------------- */

// BMW models — MUST match models/Plan.js and planController.js
const BMW_MODELS = Object.freeze([
  '2 Series Gran Coupe',
  'X1',
  '3 Series',
  'X3',
  '5 Series',
  'X5',
  'X7',
]);

// Indian mobile phone regex (10 digits, starts with 6-9)
const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

// Consent version (bump when privacy policy changes)
const CONSENT_VERSION = '1.0';


/* ---------------------------------------------------------------------
   03. SCHEMA
   --------------------------------------------------------------------- */
const WhatsAppLeadSchema = new mongoose.Schema(
  {
    /* =================================================================
       03.1. PERSONAL FIELDS
       =============================================================== */
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
      match: [
        /^[a-zA-Z\s]+$/,
        'Name can only contain letters and spaces',
      ],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      unique: true,                         // ✅ critical for duplicate prevention
      sparse: true,                         // allows multiple null (if any)
      index: true,
      maxlength: [15, 'Phone number too long'],
      match: [
        INDIAN_PHONE_REGEX,
        'Please enter a valid 10-digit Indian mobile number (starts with 6-9)',
      ],
      // Normalize: strip spaces/dashes/+91 prefix
      set: (value) => {
        if (!value) return value;
        const cleaned = String(value)
          .replace(/\s+/g, '')
          .replace(/-/g, '')
          .replace(/^\+91/, '')
          .replace(/^91(?=\d{10}$)/, '');
        return cleaned;
      },
    },
        /* =================================================================
       03.2. PLAN CONTEXT FIELDS
       =============================================================== */
    carModel: {
      type: String,
      required: [true, 'Car model is required'],
      enum: {
        values: BMW_MODELS,
        message: '"{VALUE}" is not a valid BMW model',
      },
      trim: true,
    },
    targetYear: {
      type: Number,
      required: [true, 'Target year is required'],
      min: [
        new Date().getFullYear(),
        'Target year cannot be in the past',
      ],
      max: [
        new Date().getFullYear() + 50,
        'Target year cannot exceed 50 years from now',
      ],
      validate: {
        validator: Number.isInteger,
        message: 'Target year must be a whole number',
      },
    },
    savings: {
      type: Number,
      required: [true, 'Monthly savings is required'],
      min: [1000, 'Savings must be at least ₹1,000'],
      max: [10000000, 'Savings value seems unrealistic'],
      validate: {
        validator: Number.isInteger,
        message: 'Savings must be a whole number',
      },
    },

    /* =================================================================
       03.3. CONSENT
       =============================================================== */
    consent: {
      type: Boolean,
      required: [true, 'Consent is required to save this lead'],
      default: true,
      validate: {
        validator: (v) => v === true,
        message: 'User must give consent to receive WhatsApp reminders',
      },
    },
    consentVersion: {
      type: String,
      default: CONSENT_VERSION,
      trim: true,
    },
    consentAt: {
      type: Date,
      default: Date.now,
    },

    /* =================================================================
       03.4. METADATA
       =============================================================== */
    ipAddress: {
      type: String,
      trim: true,
      maxlength: [64, 'IP address too long'],
    },
    source: {
      type: String,
      default: 'website',
      trim: true,
      enum: {
        values: ['website', 'admin', 'import', 'api'],
        message: '"{VALUE}" is not a valid source',
      },
    },
    // Track reminder status (future use — scheduler updates these)
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderSentAt: {
      type: Date,
      default: null,
    },
    // Opt-out (user can stop reminders any time)
    optedOut: {
      type: Boolean,
      default: false,
    },
    optedOutAt: {
      type: Date,
      default: null,
    },
  },
  {
    /* =================================================================
       04. SCHEMA-LEVEL OPTIONS
       =============================================================== */
    timestamps: true,                       // auto createdAt + updatedAt
    versionKey: false,                      // remove __v from responses
    toJSON: { virtuals: true },
    toObject: { virtuals: true },

    // Hide sensitive fields when sending to client
    transform: (doc, ret) => {
      delete ret.ipAddress;                 // privacy
      return ret;
    },
  }
);
/* ---------------------------------------------------------------------
   05. INDEXES
   --------------------------------------------------------------------- */

// Recent leads (admin dashboard, stats)
WhatsAppLeadSchema.index({ createdAt: -1 });

// Phone lookups (fast dedup check + already unique from field definition)
WhatsAppLeadSchema.index(
  { phone: 1 },
  { unique: true, name: 'idx_phone_unique' }
);

// Compound: leads for a specific car model
WhatsAppLeadSchema.index({ carModel: 1, createdAt: -1 });

// Pending reminders (for WhatsApp scheduler — future)
WhatsAppLeadSchema.index({ reminderSent: 1, targetYear: 1 });

// Active (non-opted-out) leads
WhatsAppLeadSchema.index({ optedOut: 1, createdAt: -1 });


/* ---------------------------------------------------------------------
   06. VIRTUALS (computed, not stored)
   --------------------------------------------------------------------- */

/**
 * Full WhatsApp international format (+91XXXXXXXXXX).
 * Useful for sending messages via WhatsApp Business API.
 */
WhatsAppLeadSchema.virtual('phoneWithCountryCode').get(function () {
  if (!this.phone) return null;
  return `+91${this.phone}`;
});

/**
 * Is this lead still active? (not opted out)
 */
WhatsAppLeadSchema.virtual('isActive').get(function () {
  return !this.optedOut;
});

/**
 * Years until target year (how long until they want their BMW).
 */
WhatsAppLeadSchema.virtual('yearsUntilTarget').get(function () {
  if (!this.targetYear) return null;
  return Math.max(0, this.targetYear - new Date().getFullYear());
});

/**
 * Should a reminder be sent now? (business logic).
 * True if: not opted out, no reminder sent yet, within 6 months of target year.
 */
WhatsAppLeadSchema.virtual('shouldSendReminder').get(function () {
  if (this.optedOut) return false;
  if (this.reminderSent) return false;
  if (!this.targetYear) return false;

  const yearsLeft = this.targetYear - new Date().getFullYear();
  return yearsLeft <= 1 && yearsLeft >= 0;
});


/* ---------------------------------------------------------------------
   07. METHODS (instance-level)
   --------------------------------------------------------------------- */

/**
 * Mark this lead as opted out (user stopped reminders).
 */
WhatsAppLeadSchema.methods.optOut = function () {
  this.optedOut = true;
  this.optedOutAt = new Date();
  return this.save();
};

/**
 * Mark reminder as sent (called by WhatsApp scheduler).
 */
WhatsAppLeadSchema.methods.markReminderSent = function () {
  this.reminderSent = true;
  this.reminderSentAt = new Date();
  return this.save();
};

/**
 * Safe public summary (no phone number or IP).
 */
WhatsAppLeadSchema.methods.toPublicSummary = function () {
  return {
    id: this._id,
    name: this.name,
    carModel: this.carModel,
    targetYear: this.targetYear,
  };
};


/* ---------------------------------------------------------------------
   08. STATIC METHODS (model-level)
   --------------------------------------------------------------------- */

/**
 * Check if a phone number is already registered.
 * Used for friendly error messages before attempting insert.
 *
 * @param {string} phone - 10-digit Indian mobile
 * @returns {Promise<boolean>}
 */
WhatsAppLeadSchema.statics.isPhoneRegistered = async function (phone) {
  if (!phone) return false;
  const cleaned = String(phone).replace(/[^\d]/g, '');
  if (!INDIAN_PHONE_REGEX.test(cleaned)) return false;

  const count = await this.countDocuments({ phone: cleaned });
  return count > 0;
};

/**
 * Find a lead by phone number (for admin lookup).
 */
WhatsAppLeadSchema.statics.findByPhone = function (phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^\d]/g, '');
  if (!INDIAN_PHONE_REGEX.test(cleaned)) return null;
  return this.findOne({ phone: cleaned });
};

/**
 * Get pending reminders (for scheduler job).
 *
 * @param {number} limit - default 100
 * @returns {Promise<Array>}
 */
WhatsAppLeadSchema.statics.getPendingReminders = function (limit = 100) {
  const currentYear = new Date().getFullYear();
  return this.find({
    reminderSent: false,
    optedOut: false,
    targetYear: { $lte: currentYear + 1, $gte: currentYear },
  })
    .sort({ targetYear: 1, createdAt: 1 })
    .limit(Math.min(limit, 500))
    .lean();
};

/**
 * Get aggregate stats for admin dashboard.
 */
WhatsAppLeadSchema.statics.getDashboardStats = async function () {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, active, todayCount, topModels] = await Promise.all([
    this.countDocuments(),
    this.countDocuments({ optedOut: false }),
    this.countDocuments({ createdAt: { $gte: todayStart } }),
    this.aggregate([
      { $match: { optedOut: false } },
      { $group: { _id: '$carModel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, carModel: '$_id', count: 1 } },
    ]),
  ]);

  return {
    total,
    active,
    optedOut: total - active,
    today: todayCount,
    topModels,
  };
};


/* ---------------------------------------------------------------------
   09. MIDDLEWARE HOOKS
   --------------------------------------------------------------------- */

/**
 * Before validating: normalize phone number.
 * (belt-and-suspenders — 'set' function already handles this, but
 *  pre-validate runs even on direct assignment bypassing setter)
 */
WhatsAppLeadSchema.pre('validate', function (next) {
  if (this.phone) {
    this.phone = String(this.phone)
      .replace(/\s+/g, '')
      .replace(/-/g, '')
      .replace(/^\+91/, '')
      .replace(/^91(?=\d{10}$)/, '');
  }
  if (this.name) {
    this.name = String(this.name).trim();
  }
  next();
});

/**
 * Before saving: set consentAt timestamp if consent is true and not set.
 */
WhatsAppLeadSchema.pre('save', function (next) {
  if (this.consent && !this.consentAt) {
    this.consentAt = new Date();
  }
  if (this.optedOut && !this.optedOutAt) {
    this.optedOutAt = new Date();
  }
  next();
});

/**
 * Post-save: log in development only.
 */
WhatsAppLeadSchema.post('save', function (doc) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`✅ WhatsApp lead saved: ${doc.name} (${doc.phone.slice(-4).padStart(10, '*')})`);
  }
});


/* ---------------------------------------------------------------------
   10. EXPORT
   --------------------------------------------------------------------- */
module.exports = mongoose.model('WhatsAppLead', WhatsAppLeadSchema);