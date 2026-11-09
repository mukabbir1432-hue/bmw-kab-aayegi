/* =====================================================================
   BMW KAB AAYEGI? — PLAN MODEL
   =====================================================================
   File     : models/Plan.js
   Version  : 3.0.0
   Purpose  : Mongoose schema for saved plan calculations
   
   Connections:
   ─────────────────────────────────────────────────────────────────────
   • controllers/planController.js → computePlan() ke fields yahan store
   • controllers/planController.js → referralCode (unique) lookup karta
   • controllers/planController.js → referredBy (match) validate karta
   • routes/api.js                → /admin/leads se list karta
   • script.js                    → referralCode frontend pe show karta
   
   Structure:
   ─────────────────────────────────────────────────────────────────────
   01. Imports
   02. Constants (BMW models, validators)
   03. Sub-schemas (none — flat structure)
   04. Main Schema
       04.1. Personal fields
       04.2. Financial fields
       04.3. Timeline fields
       04.4. Referral fields
       04.5. Metadata fields
   05. Schema-level options (timestamps, toJSON, etc.)
   ===================================================================== */

const mongoose = require('mongoose');


/* ---------------------------------------------------------------------
   02. CONSTANTS
   --------------------------------------------------------------------- */

// Valid BMW models — MUST match controllers/planController.js CAR_PRICES keys
const BMW_MODELS = Object.freeze([
  '2 Series Gran Coupe',
  'X1',
  '3 Series',
  'X3',
  '5 Series',
  'X5',
  'X7',
]);

// Referral code format — 3 uppercase letters + 4 digits (RAH1234)
const REFERRAL_CODE_REGEX = /^[A-Z]{3}\d{4}$/;

// Current year (for targetYear validation)
const CURRENT_YEAR = new Date().getFullYear();


/* ---------------------------------------------------------------------
   03. CUSTOM VALIDATORS (reusable)
   --------------------------------------------------------------------- */

/**
 * Validates that a value is a positive integer.
 */
const isPositiveInt = (value) => Number.isInteger(value) && value >= 0;

/**
 * Validates that a value is a positive number (allows decimals).
 */
const isPositiveNumber = (value) => typeof value === 'number' && value >= 0;


/* ---------------------------------------------------------------------
   04. MAIN SCHEMA
   --------------------------------------------------------------------- */
const PlanSchema = new mongoose.Schema(
  {
    /* =================================================================
       04.1. PERSONAL FIELDS
       =============================================================== */
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [50, 'Name cannot exceed 50 characters'],
      // Only allow letters and spaces (matches frontend validateForm)
      match: [
        /^[a-zA-Z\s]+$/,
        'Name can only contain letters and spaces',
      ],
    },
    age: {
      type: Number,
      required: [true, 'Age is required'],
      min: [18, 'Age must be at least 18'],
      max: [80, 'Age cannot exceed 80'],
      validate: {
        validator: Number.isInteger,
        message: 'Age must be a whole number',
      },
    },

    /* =================================================================
       04.2. FINANCIAL FIELDS
       =============================================================== */
    savings: {
      type: Number,
      required: [true, 'Monthly savings is required'],
      min: [1000, 'Savings must be at least ₹1,000'],
      max: [10000000, 'Savings value seems unrealistic'],
      validate: {
        validator: isPositiveInt,
        message: 'Savings must be a whole number',
      },
    },
    carModel: {
      type: String,
      required: [true, 'Car model is required'],
      enum: {
        values: BMW_MODELS,
        message: '"{VALUE}" is not a valid BMW model',
      },
      trim: true,
    },
    carPrice: {
      type: Number,
      required: [true, 'Car price is required'],
      min: [0, 'Car price cannot be negative'],
      validate: {
        validator: isPositiveNumber,
        message: 'Car price must be a positive number',
      },
    },
    downPayment: {
      type: Number,
      required: [true, 'Down payment is required'],
      min: [0, 'Down payment cannot be negative'],
      validate: {
        validator: isPositiveNumber,
        message: 'Down payment must be a positive number',
      },
    },
    loanAmount: {
      type: Number,
      required: false,                  // optional for backward compatibility
      min: [0, 'Loan amount cannot be negative'],
      validate: {
        validator: isPositiveNumber,
        message: 'Loan amount must be a positive number',
      },
    },
    emi: {
      type: Number,
      required: [true, 'EMI is required'],
      min: [0, 'EMI cannot be negative'],
      validate: {
        validator: isPositiveNumber,
        message: 'EMI must be a positive number',
      },
    },

    /* =================================================================
       04.3. TIMELINE FIELDS
       =============================================================== */
    yearsNeeded: {
      type: Number,
      required: [true, 'Years needed is required'],
      min: [0, 'Years needed cannot be negative'],
      max: [50, 'Years needed cannot exceed 50'],
      validate: {
        validator: isPositiveNumber,
        message: 'Years needed must be a positive number',
      },
    },
    targetYear: {
      type: Number,
      required: [true, 'Target year is required'],
      min: [CURRENT_YEAR, `Target year cannot be before ${CURRENT_YEAR}`],
      max: [CURRENT_YEAR + 50, `Target year cannot exceed ${CURRENT_YEAR + 50}`],
      validate: {
        validator: Number.isInteger,
        message: 'Target year must be a whole number',
      },
    },

    /* =================================================================
       04.4. REFERRAL FIELDS
       =============================================================== */
    // This user's OWN referral code (generated server-side, unique)
    referralCode: {
      type: String,
      unique: true,
      sparse: true,                     // allows null (users without code)
      trim: true,
      uppercase: true,
      index: true,
      match: [
        REFERRAL_CODE_REGEX,
        'Referral code must be 3 letters + 4 digits (e.g., RAH1234)',
      ],
    },
    // The code of the user WHO REFERRED this user (can be null)
    referredBy: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [20, 'Referrer code too long'],
      index: true,
      match: [
        REFERRAL_CODE_REGEX,
        'Referrer code must be 3 letters + 4 digits (e.g., RAH1234)',
      ],
    },
    // How many users this user has referred
    referralCount: {
      type: Number,
      default: 0,
      min: [0, 'Referral count cannot be negative'],
      validate: {
        validator: isPositiveInt,
        message: 'Referral count must be a whole number',
      },
    },

    /* =================================================================
       04.5. METADATA FIELDS
       =============================================================== */
    ipAddress: {
      type: String,
      trim: true,
      maxlength: [64, 'IP address too long'],   // IPv6 can be up to 45 chars
    },
    source: {
      type: String,
      default: 'website',
      trim: true,
      enum: {
        values: ['website', 'admin', 'import', 'api'],
        message: '"{VALUE}" is not a valid source',
      },
      maxlength: [50, 'Source too long'],
    },
  },
  {
    /* =================================================================
       05. SCHEMA-LEVEL OPTIONS
       =============================================================== */
    timestamps: true,                   // auto createdAt + updatedAt

    // Remove __v from responses (cleaner JSON)
    versionKey: false,

    // Include virtuals when converting to JSON (for API responses)
    toJSON: { virtuals: true },
    toObject: { virtuals: true },

    // Custom transform — remove sensitive fields when serializing
    transform: (doc, ret) => {
      // Don't expose raw IP in API responses (privacy)
      delete ret.ipAddress;
      return ret;
    },
  }
);
/* ---------------------------------------------------------------------
   06. INDEXES
   ---------------------------------------------------------------------
   Indexes make common queries fast. Over-indexing hurts writes,
   so we only add indexes for frequently-queried fields.
   --------------------------------------------------------------------- */

// Most common: recent plans (admin dashboard, stats)
PlanSchema.index({ createdAt: -1 });

// Stats aggregation: top car models
PlanSchema.index({ carModel: 1 });

// Compound: recent plans for a specific car model
PlanSchema.index({ carModel: 1, createdAt: -1 });

// Referral code lookups (already unique + sparse from field definition,
// but explicit here for clarity and to enforce uniqueness even if
// someone removes 'unique: true' from the field)
PlanSchema.index(
  { referralCode: 1 },
  { unique: true, sparse: true, name: 'idx_referral_code_unique' }
);

// Who did this code refer? (for referral leaderboards)
PlanSchema.index({ referredBy: 1, createdAt: -1 });

// Metadata queries
PlanSchema.index({ source: 1 });


/* ---------------------------------------------------------------------
   07. VIRTUALS (computed, not stored)
   --------------------------------------------------------------------- */

/**
 * Full referral URL — useful for admin dashboard and sharing.
 * Example: https://bmwkabayegi.in?ref=RAH1234
 */
PlanSchema.virtual('referralUrl').get(function () {
  if (!this.referralCode) return null;
  const base = process.env.FRONTEND_URL || 'https://bmwkabayegi.in';
  // Strip trailing slash from base, add ?ref=
  return `${base.replace(/\/$/, '')}?ref=${this.referralCode}`;
});

/**
 * Down payment as percentage of car price (0–100).
 */
PlanSchema.virtual('downPaymentPercent').get(function () {
  if (!this.carPrice || this.carPrice === 0) return 0;
  if (this.downPayment == null) return 0;
  return Math.round((this.downPayment / this.carPrice) * 100);
});

/**
 * EMI as percentage of monthly income (assuming income = savings * 5).
 * Rough affordability estimate — not financial advice.
 */
PlanSchema.virtual('emiToIncomeRatio').get(function () {
  if (!this.savings || this.savings === 0) return null;
  if (this.emi == null) return null;
  const estimatedMonthlyIncome = this.savings * 5;
  return Math.round((this.emi / estimatedMonthlyIncome) * 100);
});

/**
 * Is this plan realistic? (down payment in ≤ 10 years)
 */
PlanSchema.virtual('isRealistic').get(function () {
  return typeof this.yearsNeeded === 'number' && this.yearsNeeded <= 10;
});


/* ---------------------------------------------------------------------
   08. INSTANCE METHODS
   --------------------------------------------------------------------- */

/**
 * Mark this plan as shared (increment share counter).
 * Call after WhatsApp share or copy-link action.
 */
PlanSchema.methods.recordShare = function () {
  this.shareCount = (this.shareCount || 0) + 1;
  return this.save();
};

/**
 * Return a safe summary (no PII) for public display.
 */
PlanSchema.methods.toPublicSummary = function () {
  return {
    id: this._id,
    name: this.name,
    carModel: this.carModel,
    targetYear: this.targetYear,
    referralCode: this.referralCode,
  };
};


/* ---------------------------------------------------------------------
   09. STATIC METHODS
   --------------------------------------------------------------------- */

/**
 * Find a plan by its own referral code.
 * Case-insensitive lookup, returns null if not found.
 *
 * @param {string} code - e.g., "RAH1234"
 * @returns {Promise<Plan|null>}
 */
PlanSchema.statics.findByReferralCode = function (code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!REFERRAL_CODE_REGEX.test(normalized)) return null;
  return this.findOne({ referralCode: normalized });
};

/**
 * Increment referral count for a referrer.
 * Safe: if referrer not found, silently returns null (doesn't throw).
 *
 * @param {string} code - referrer's code
 * @returns {Promise<Plan|null>} - updated referrer or null
 */
PlanSchema.statics.incrementReferralCount = async function (code) {
  if (!code || typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  if (!REFERRAL_CODE_REGEX.test(normalized)) return null;

  return this.findOneAndUpdate(
    { referralCode: normalized },
    { $inc: { referralCount: 1 } },
    { new: true }
  );
};

/**
 * Get the top referrers (leaderboard).
 *
 * @param {number} limit - default 10
 * @returns {Promise<Array>}
 */
PlanSchema.statics.getTopReferrers = function (limit = 10) {
  return this.find({ referralCount: { $gt: 0 } })
    .sort({ referralCount: -1 })
    .limit(Math.min(limit, 100))
    .select('name referralCode referralCount')
    .lean();
};

/**
 * Get aggregate stats for the dashboard.
 * Returns total, today's count, top models, top referrers.
 */
PlanSchema.statics.getDashboardStats = async function () {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [total, today, topModels, topReferrers] = await Promise.all([
    this.countDocuments(),
    this.countDocuments({ createdAt: { $gte: todayStart } }),
    this.aggregate([
      { $group: { _id: '$carModel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, carModel: '$_id', count: 1 } },
    ]),
    this.getTopReferrers(5),
  ]);

  return { total, today, topModels, topReferrers };
};


/* ---------------------------------------------------------------------
   10. MIDDLEWARE HOOKS (pre/post save)
   --------------------------------------------------------------------- */

/**
 * Before validating: normalize referral codes to uppercase.
 * This ensures "rah1234" and "RAH1234" match.
 */
PlanSchema.pre('validate', function (next) {
  if (this.referralCode) {
    this.referralCode = String(this.referralCode).trim().toUpperCase();
  }
  if (this.referredBy) {
    this.referredBy = String(this.referredBy).trim().toUpperCase();
  }
  next();
});

/**
 * Before saving: ensure referralCount is never negative.
 */
PlanSchema.pre('save', function (next) {
  if (this.referralCount < 0) this.referralCount = 0;
  next();
});

/**
 * After saving: log for debugging (only in development).
 * This doesn't run in production (no console noise).
 */
PlanSchema.post('save', function (doc) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`✅ Plan saved: ${doc.name} → ${doc.carModel} (${doc.referralCode})`);
  }
});


/* ---------------------------------------------------------------------
   11. EXPORT
   --------------------------------------------------------------------- */
module.exports = mongoose.model('Plan', PlanSchema);