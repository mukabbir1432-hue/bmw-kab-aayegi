/* =====================================================================
   BMW KAB AAYEGI? — PLAN CONTROLLER
   =====================================================================
   File     : controllers/planController.js
   Version  : 2.0.0
   Purpose  : Business logic for plan calculation, lead saving, analytics
   
   STRUCTURE:
   ─────────────────────────────────────────────────────────────────────
   01. Imports
   02. Constants (car prices, savings map)
   03. Helpers (sanitize, validate, calc)
   04. Controllers (see Part 2 & 3)
   ===================================================================== */

const Plan = require('../models/Plan');
const Event = require('../models/Event');
const WhatsAppLead = require('../models/WhatsAppLead');
const xss = require('xss');


/* ---------------------------------------------------------------------
   02. CONSTANTS
   --------------------------------------------------------------------- */

// BMW car prices (ex-showroom, in INR, approximate)
const CAR_PRICES = {
  '2 Series Gran Coupe': 4580000,
  'X1': 5090000,
  '3 Series': 7285000,
  'X3': 7250000,
  '5 Series': 7480000,
  'X5': 9370000,
  'X7': 12600000,
};

// Monthly savings options (strings frontend sends → numeric)
const SAVINGS_MAP = {
  '₹5,000': 5000,
  '₹10,000': 10000,
  '₹15,000': 15000,
  '₹20,000': 20000,
  '₹25,000+': 25000,
};

// Referral code regex (3 letters + 4 digits, e.g., RAH1234)
const REFERRAL_CODE_REGEX = /^[A-Z]{3}\d{4}$/;


/* ---------------------------------------------------------------------
   03. HELPERS
   --------------------------------------------------------------------- */

/**
 * Sanitize string input to prevent XSS.
 */
const sanitizeInput = (value) => {
  if (typeof value === 'string') return xss(value.trim());
  return value;
};

/**
 * Convert savings to numeric value.
 * Accepts: number (5000), string ("5000"), display string ("₹5,000")
 */
const parseSavings = (savings) => {
  if (typeof savings === 'number') return savings;
  if (typeof savings === 'string') {
    if (SAVINGS_MAP[savings]) return SAVINGS_MAP[savings];
    return parseInt(savings.replace(/[^\d]/g, ''), 10) || 0;
  }
  return 0;
};

/**
 * Core calculation logic — shared by calculatePlan and saveLead.
 * All math is server-side, no trust in client values.
 *
 * @param {Object} input - { name, age, savings, carModel }
 * @returns {Object|null} plan object or null if invalid
 */
const computePlan = ({ name, age, savings, carModel }) => {
  const cleanName = sanitizeInput(name);
  const cleanAge = parseInt(age, 10);
  const cleanSavings = parseSavings(savings);
  const cleanCarModel = sanitizeInput(carModel);

  // Validate
  if (!cleanName || cleanName.length < 2) return null;
  if (isNaN(cleanAge) || cleanAge < 18 || cleanAge > 80) return null;
  if (!cleanSavings || cleanSavings <= 0) return null;
  if (!CAR_PRICES[cleanCarModel]) return null;

  const carPrice = CAR_PRICES[cleanCarModel];
  const downPayment = Math.round(carPrice * 0.20);
  const loanAmount = Math.round(carPrice * 0.80);

  // EMI: P * r * (1+r)^n / ((1+r)^n - 1)
  const P = loanAmount;
  const r = 0.09 / 12;   // 9% annual, monthly
  const n = 60;          // 5 years
  const emi = Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

  // Years needed to save down payment
  const yearsNeeded = Math.round((downPayment / (cleanSavings * 12)) * 10) / 10;

  // Target year
  const targetYear = new Date().getFullYear() + Math.ceil(yearsNeeded);

  return {
    name: cleanName,
    age: cleanAge,
    savings: cleanSavings,
    carModel: cleanCarModel,
    carPrice,
    downPayment,
    loanAmount,
    emi,
    yearsNeeded,
    targetYear,
  };
};

/**
 * Generate a referral code based on name (matches frontend logic).
 * Frontend uses: name[0..3] + random 4 digits.
 */
const generateReferralCode = (name) => {
  const prefix = (name || 'BMW').trim().slice(0, 3).toUpperCase() || 'BMW';
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${random}`;
};

/**
 * Validate referral code format.
 */
const isValidReferralCode = (code) => {
  if (!code) return false;
  return REFERRAL_CODE_REGEX.test(String(code).trim().toUpperCase());
};
/* ---------------------------------------------------------------------
   04. PUBLIC CONTROLLERS
   --------------------------------------------------------------------- */

/**
 * GET /api/health
 * Simple health check.
 */
exports.healthCheck = (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
};


/**
 * POST /api/calculate
 * Body: { name, age, savings, carModel }
 * Returns: { success, plan }
 */
exports.calculatePlan = (req, res) => {
  try {
    const { name, age, savings, carModel } = req.body || {};

    const plan = computePlan({ name, age, savings, carModel });

    if (!plan) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input. Check name, age (18-80), savings, and car model.',
      });
    }

    return res.status(200).json({ success: true, plan });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


/**
 * POST /api/save-lead
 * Body: { name, age, savings, carModel, referrerCode? }
 *
 * ✅ FIXED: All financial values re-calculated server-side.
 * ✅ FIXED: Referral count updates using referralCode lookup.
 * ✅ FIXED: Referral code format validated.
 */
exports.saveLead = async (req, res) => {
  try {
    const { name, age, savings, carModel, referrerCode } = req.body || {};

    // 1. Recalculate plan server-side (never trust client values)
    const plan = computePlan({ name, age, savings, carModel });
    if (!plan) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input.',
      });
    }

    // 2. Validate referral code (if provided)
    let validatedReferrerCode = null;
    if (referrerCode) {
      const upperCode = String(referrerCode).trim().toUpperCase();
      if (isValidReferralCode(upperCode)) {
        validatedReferrerCode = upperCode;
      }
    }

    // 3. Generate this user's own referral code
    const ownReferralCode = generateReferralCode(plan.name);

    // 4. Build lead document
    const leadData = {
      ...plan,
      ipAddress: req.ip || req.connection?.remoteAddress,
      source: 'website',
      referralCode: ownReferralCode,
      referralCount: 0,
    };

    if (validatedReferrerCode) {
      leadData.referredBy = validatedReferrerCode;
    }

    // 5. Save lead
    const lead = await Plan.create(leadData);

    // 6. Increment referrer's count (if valid and referrer exists)
    if (validatedReferrerCode) {
      try {
        await Plan.updateOne(
          { referralCode: validatedReferrerCode },   // ✅ correct lookup
          { $inc: { referralCount: 1 } }
        );
      } catch (refErr) {
        // Non-critical — don't fail lead creation
        console.error('Referral count update failed:', refErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      id: lead._id,
      referralCode: ownReferralCode,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};


/**
 * GET /api/stats
 * Returns aggregate stats.
 */
exports.getStats = async (req, res) => {
  try {
    const totalCalculations = await Plan.countDocuments();

    const topModels = await Plan.aggregate([
      { $group: { _id: '$carModel', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 },
      { $project: { _id: 0, carModel: '$_id', count: 1 } },
    ]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayCount = await Plan.countDocuments({
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });

    return res.status(200).json({
      success: true,
      totalCalculations,
      topModels,
      todayCount,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};


/**
 * POST /api/track-event
 * Body: { eventName, carModel? }
 */
exports.trackEvent = async (req, res) => {
  try {
    const { eventName, carModel } = req.body || {};

    if (!eventName || typeof eventName !== 'string') {
      return res.status(400).json({ success: false, error: 'Event name is required' });
    }

    // Hash IP for privacy (simple, non-cryptographic)
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const hashedIp = ipAddress
      .split('')
      .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
      .toString(16);

    const userAgent = req.get('User-Agent') || '';

    const event = await Event.create({
      eventName: sanitizeInput(eventName),
      carModel: carModel ? sanitizeInput(carModel) : undefined,
      ipAddress: hashedIp,
      userAgent: userAgent.slice(0, 200),
    });

    return res.status(201).json({ success: true, id: event._id });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};
/**
 * POST /api/save-whatsapp-lead
 * Body: { name, phone, carModel, targetYear, savings }
 *
 * Validates phone format (10 digits, starts with 6-9).
 */
exports.saveWhatsAppLead = async (req, res) => {
  try {
    const { name, phone, carModel, targetYear, savings } = req.body || {};

    const cleanName = sanitizeInput(name);
    const cleanPhone = String(phone || '').trim();
    const cleanCarModel = sanitizeInput(carModel);
    const cleanTargetYear = parseInt(targetYear, 10);
    const cleanSavings = parseSavings(savings);

    // Required fields
    if (!cleanName || !cleanPhone || !cleanCarModel) {
      return res.status(400).json({
        success: false,
        error: 'Name, phone, and car model are required.',
      });
    }

    // Phone validation: 10 digits, Indian mobile (starts 6-9)
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid 10-digit Indian mobile number.',
      });
    }

    // Car model validation
    if (!CAR_PRICES[cleanCarModel]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid car model.',
      });
    }

    const lead = await WhatsAppLead.create({
      name: cleanName,
      phone: cleanPhone,
      carModel: cleanCarModel,
      targetYear: cleanTargetYear || new Date().getFullYear() + 2,
      savings: cleanSavings,
      consent: true,
    });

    return res.status(201).json({
      success: true,
      id: lead._id,
      message: 'Lead saved successfully',
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: error.message });
    }
    if (error.code === 11000) {
      // Duplicate key (phone unique index)
      return res.status(409).json({
        success: false,
        error: 'This phone number is already registered.',
      });
    }
    return res.status(500).json({ success: false, error: error.message });
  }
};