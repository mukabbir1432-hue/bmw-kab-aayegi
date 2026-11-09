/* =====================================================================
   BMW KAB AAYEGI? — MAIN FRONTEND SCRIPT
   =====================================================================
   File     : script.js
   Version  : 4.0.0
   Purpose  : Frontend logic — calculator, forms, referral, analytics
   
   ARCHITECTURE
   ─────────────────────────────────────────────────────────────────────
   • IIFE wrapper — no globals leaked
   • 'use strict' — catches silent errors
   • Modular structure — each section independent
   • Security-first — all user input sanitized before DOM
   • Fail-silent analytics — tracking never breaks UX
   
   STRUCTURE
   ─────────────────────────────────────────────────────────────────────
   Part 1 — Setup, Security, Formatters, Tracking, Referral
   Part 2 — DOM refs, Mobile menu, Delivery form
   Part 3 — Calculator, Validation, Loading, API
   Part 4 — WhatsApp lead, Referral UI, Reset, Share
   Part 5 — Result rendering, Error helpers, Close
   
   CONNECTIONS
   ─────────────────────────────────────────────────────────────────────
   • window.CONFIG.BACKEND_URL → /api/* calls
   • index.html               → all DOM IDs referenced here
   • /api/calculate           → returns plan
   • /api/save-lead           → returns { referralCode }
   • /api/save-whatsapp-lead  → returns { id }
   • /api/track-event         → fire-and-forget
   ===================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------
     01. API CONFIGURATION
     ------------------------------------------------------------------- */
  const API_BASE =
    (window.CONFIG && window.CONFIG.BACKEND_URL) || '';

  // Fail-safe: if API_BASE is empty, disable backend calls
  const API_ENABLED = Boolean(API_BASE);

  /* -------------------------------------------------------------------
     02. CONSTANTS
     ------------------------------------------------------------------- */

  // Referral code format (matches backend REFERRAL_CODE_REGEX)
  const REFERRAL_CODE_REGEX = /^[A-Z]{3}\d{4}$/;

  // Indian mobile phone format
  const PHONE_REGEX = /^[6-9]\d{9}$/;

  // Name format (letters + spaces only)
  const NAME_REGEX = /^[a-zA-Z\s]+$/;

  // Model slug → display name (backend expects display name)
  const MODEL_DISPLAY_MAP = Object.freeze({
    '2-series-gran-coupe': '2 Series Gran Coupe',
    'x1': 'X1',
    '3-series': '3 Series',
    'x3': 'X3',
    '5-series': '5 Series',
    'x5': 'X5',
    'x7': 'X7',
  });

  // Delivery estimate days (bottom form)
  const DELIVERY_DAYS = Object.freeze({
    'bmw-3-series': 45,
    'bmw-5-series': 60,
    'bmw-x1': 50,
    'bmw-x3': 55,
    'bmw-x5': 70,
    'bmw-i4': 90,
    'bmw-i7': 120,
  });

  // Loading messages rotation
  const LOADING_MESSAGES = Object.freeze([
    'Aapki kismat check ho rahi hai...',
    'BMW showroom se baat ho rahi hai...',
    'Aapke sapno ka calculation chal raha hai...',
    'Bank manager ko chai pilai ja rahi hai...',
    'Final result aa raha hai...',
  ]);

  // Storage keys (single source of truth)
  const STORAGE_KEYS = Object.freeze({
    REFERRER_CODE: 'referrer_code',
  });


  /* -------------------------------------------------------------------
     03. SECURITY HELPERS
     ------------------------------------------------------------------- */

  /**
   * Escape HTML special chars to prevent XSS.
   * Use before inserting any user-supplied string via innerHTML.
   * NOTE: We use textContent everywhere (primary defense), so this is
   * a secondary safety net for edge cases.
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Validate referral code. Returns clean string or null.
   */
  function validateReferralCode(code) {
    if (!code || typeof code !== 'string') return null;
    const cleaned = code.trim().toUpperCase();
    return REFERRAL_CODE_REGEX.test(cleaned) ? cleaned : null;
  }

  /**
   * Validate phone. Returns clean 10-digit string or null.
   */
  function validatePhone(phone) {
    if (!phone) return null;
    const cleaned = String(phone).replace(/\D/g, '').slice(-10);
    return PHONE_REGEX.test(cleaned) ? cleaned : null;
  }

  /**
   * Validate name. Returns trimmed string or null.
   */
  function validateName(name) {
    if (!name || typeof name !== 'string') return null;
    const cleaned = name.trim();
    if (cleaned.length < 2 || cleaned.length > 50) return null;
    if (!NAME_REGEX.test(cleaned)) return null;
    return cleaned;
  }


  /* -------------------------------------------------------------------
     04. FORMATTERS
     ------------------------------------------------------------------- */

  /**
   * Format number as Indian Rupees (₹1,23,456).
   */
  function formatINR(num) {
    const n = Number(num);
    if (!isFinite(n) || n < 0) return '₹0';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(n);
  }

  /**
   * Format number with Indian separators (1,23,456).
   */
  function formatNumber(num) {
    const n = Number(num);
    if (!isFinite(n)) return '0';
    return n.toLocaleString('en-IN');
  }

  /**
   * Format date for display (e.g., "Monday, 15 January 2026").
   */
  function formatDate(date) {
    try {
      return date.toLocaleDateString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (_) {
      return date.toDateString();
    }
  }


  /* -------------------------------------------------------------------
     05. ANALYTICS TRACKING
     ------------------------------------------------------------------- */

  /**
   * Track event via GA4 + backend fallback.
   * Never throws — analytics must not break user flow.
   */
  function trackEvent(eventName, params) {
    const p = params || {};

    // GA4 (if loaded)
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, p);
      }
    } catch (_) {
      /* silent */
    }

    // Backend fallback
    try {
      if (!API_ENABLED) return;
      fetch(API_BASE + '/api/track-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName: String(eventName || '').slice(0, 50),
          carModel: p.car_model || p.carModel || '',
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (_) {
      /* silent */
    }
  }


  /* -------------------------------------------------------------------
     06. REFERRAL STORAGE
     ------------------------------------------------------------------- */

  /**
   * Read ?ref=CODE from URL, validate, store in localStorage.
   */
  function captureReferralFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('ref');
      if (!raw) return;

      const valid = validateReferralCode(raw);
      if (!valid) return; // silently ignore invalid

      localStorage.setItem(STORAGE_KEYS.REFERRER_CODE, valid);
      trackEvent('referral_visit', { referrer_code: valid });
    } catch (_) {
      /* silent */
    }
  }

  /**
   * Get stored referral code (validated).
   */
  function getStoredReferralCode() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.REFERRER_CODE);
      return validateReferralCode(stored);
    } catch (_) {
      return null;
    }
  }

  /**
   * Clear stored referral code (after successful attribution).
   */
  function clearStoredReferralCode() {
    try {
      localStorage.removeItem(STORAGE_KEYS.REFERRER_CODE);
    } catch (_) {
      /* silent */
    }
  }
    /* -------------------------------------------------------------------
     07. INITIALIZATION (after DOM ready)
     ------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {

    /* ========== 07.1 DOM HELPERS ========== */
    const $ = function (id) {
      return document.getElementById(id);
    };

    const setText = function (id, text) {
      const el = $(id);
      if (el) el.textContent = text;
    };

    const setHTML = function (id, html) {
      const el = $(id);
      if (el) el.innerHTML = html;
    };

    const showEl = function (id) {
      const el = $(id);
      if (el) el.style.display = 'block';
    };

    const hideEl = function (id) {
      const el = $(id);
      if (el) el.style.display = 'none';
    };


    /* ========== 07.2 DOM REFERENCES ========== */
    const refs = {
      // Delivery form
      deliveryForm: $('deliveryForm'),
      resultSection: $('result'),
      resultName: $('resultName'),
      resultDate: $('resultDate'),
      resultMessage: $('resultMessage'),
      editBtn: $('editBtn'),
      shareBtn: $('shareBtn'),

      // Mobile nav
      navToggle: document.querySelector('.nav-toggle'),
      navMobile: document.querySelector('.nav-mobile'),

      // Calculator
      calcForm: $('bmwCalculatorForm'),
      calculatorSection: document.querySelector('.calculator-section'),
      loadingSection: $('loadingSection'),
      loadingMessage: $('loadingMessage'),
      planResultSection: $('planResult'),
    };

    const CALC_FIELDS = ['calcName', 'calcAge', 'calcSavings', 'calcModel'];


    /* ========== 07.3 CAPTURE REFERRAL (before anything else) ========== */
    captureReferralFromUrl();


    /* ========== 07.4 MOBILE MENU ========== */
    if (refs.navToggle && refs.navMobile) {
      refs.navToggle.addEventListener('click', function () {
        const isOpen = refs.navMobile.classList.toggle('active');
        refs.navToggle.classList.toggle('active', isOpen);
        refs.navToggle.setAttribute('aria-expanded', String(isOpen));
      });

      // Close on outside click
      document.addEventListener('click', function (e) {
        if (!refs.navMobile.classList.contains('active')) return;
        if (refs.navToggle.contains(e.target)) return;
        if (refs.navMobile.contains(e.target)) return;
        refs.navMobile.classList.remove('active');
        refs.navToggle.classList.remove('active');
        refs.navToggle.setAttribute('aria-expanded', 'false');
      });

      // Close on Escape
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!refs.navMobile.classList.contains('active')) return;
        refs.navMobile.classList.remove('active');
        refs.navToggle.classList.remove('active');
        refs.navToggle.setAttribute('aria-expanded', 'false');
      });
    }


    /* ========== 07.5 SMOOTH SCROLL ========== */
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        const href = anchor.getAttribute('href');
        if (!href || href === '#' || href.length < 2) return;

        const target = document.querySelector(href);
        if (!target) return;

        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Close mobile menu if open
        if (refs.navMobile) refs.navMobile.classList.remove('active');
        if (refs.navToggle) refs.navToggle.classList.remove('active');
      });
    });


    /* ========== 07.6 DELIVERY FORM (bottom) ========== */
    if (refs.deliveryForm) {
      refs.deliveryForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const formData = new FormData(refs.deliveryForm);
        const name = String(formData.get('name') || '').trim();
        const model = String(formData.get('model') || '').trim();
        const city = String(formData.get('city') || '').trim();

        // Validate (basic — HTML required handles most)
        if (!name || !model || !city) {
          alert('Please fill all fields.');
          return;
        }

        // Compute delivery date
        const days = DELIVERY_DAYS[model] || 60;
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + days);
        const formattedDate = formatDate(deliveryDate);

        // Update DOM (safe — textContent)
        if (refs.resultName) refs.resultName.textContent = name;
        if (refs.resultDate) refs.resultDate.textContent = formattedDate;
        if (refs.resultMessage) {
          refs.resultMessage.textContent =
            'Thank you, ' + name + '! Your BMW ' + model +
            ' for ' + city + ' is on its way.';
        }

        // Show result
        refs.deliveryForm.style.display = 'none';
        if (refs.resultSection) {
          refs.resultSection.hidden = false;
          refs.resultSection.scrollIntoView({ behavior: 'smooth' });
        }

        trackEvent('delivery_form_submit', { model: model });
      });
    }

    if (refs.editBtn) {
      refs.editBtn.addEventListener('click', function () {
        if (refs.deliveryForm) refs.deliveryForm.style.display = 'grid';
        if (refs.resultSection) refs.resultSection.hidden = true;
      });
    }

    if (refs.shareBtn) {
      refs.shareBtn.addEventListener('click', function () {
        const text = 'Check my BMW delivery estimate on BMW Kab Aayegi?';
        if (navigator.share) {
          navigator.share({ title: 'BMW Kab Aayegi?', text: text })
            .catch(function () {});
        } else {
          alert('Estimate ready! (Web Share API not supported in this browser)');
        }
      });
    }
        /* ========== 07.7 CALCULATOR INPUT LISTENERS ========== */
    CALC_FIELDS.forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', function () { clearError(id); });
      el.addEventListener('change', function () { clearError(id); });
    });

    // Track form start (once)
    const firstInput = $('calcName');
    if (firstInput) {
      firstInput.addEventListener(
        'focus',
        function () { trackEvent('form_start'); },
        { once: true }
      );
    }


    /* ========== 07.8 CALCULATOR SUBMIT ========== */
    if (refs.calcForm) {
      refs.calcForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        // Clear previous errors
        CALC_FIELDS.forEach(clearError);

        // Validate
        if (!validateCalcForm()) return;

        trackEvent('calculate_click');

        // Gather & normalize inputs
        const name = String($('calcName').value || '').trim();
        const age = parseInt($('calcAge').value, 10);
        const savings = parseInt($('calcSavings').value, 10);
        const carModelRaw = String($('calcModel').value || '');
        const carModelSlug = carModelRaw.split('|')[0].trim();
        const carModelDisplay =
          MODEL_DISPLAY_MAP[carModelSlug] || carModelSlug;

        // Show loading
        if (refs.calculatorSection) refs.calculatorSection.style.display = 'none';
        if (refs.loadingSection) {
          refs.loadingSection.hidden = false;
          refs.loadingSection.style.opacity = '1';
        }

        // Rotate loading messages
        let msgIndex = 0;
        if (refs.loadingMessage) refs.loadingMessage.textContent = LOADING_MESSAGES[0];
        const msgInterval = setInterval(function () {
          msgIndex = (msgIndex + 1) % LOADING_MESSAGES.length;
          if (refs.loadingMessage) refs.loadingMessage.textContent = LOADING_MESSAGES[msgIndex];
        }, 800);

        const startTime = Date.now();
        let succeeded = false;

        try {
          if (!API_ENABLED) throw new Error('Backend not configured');

          const res = await fetch(API_BASE + '/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name,
              age: age,
              savings: savings,
              carModel: carModelDisplay,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(function () { return {}; });
            throw new Error(errData.error || 'Calculation failed');
          }

          const data = await res.json();
          const planData = data.plan || data;

          // Enforce minimum 2.5s loading (UX)
          const elapsed = Date.now() - startTime;
          const remainingWait = Math.max(0, 2500 - elapsed);

          setTimeout(function () {
            clearInterval(msgInterval);
            if (refs.loadingSection) refs.loadingSection.style.opacity = '0';

            setTimeout(function () {
              if (refs.loadingSection) refs.loadingSection.hidden = true;

              // Render result
              renderResult(planData);

              // Save lead (fire-and-forget)
              saveLeadAsync({
                name: name,
                age: age,
                savings: savings,
                carModel: carModelDisplay,
              });

              setTimeout(function () {
                if (refs.planResultSection) {
                  refs.planResultSection.scrollIntoView({ behavior: 'smooth' });
                }
              }, 100);
            }, 300);
          }, remainingWait);

          succeeded = true;
        } catch (error) {
          clearInterval(msgInterval);
          if (refs.loadingSection) refs.loadingSection.hidden = true;
          if (refs.calculatorSection) refs.calculatorSection.style.display = 'grid';

          const msg = (error && error.message) || 'Kuch gadbad ho gayi';
          console.error('Calculation error:', error);
          alert(msg + ' — thodi der baad try karein.');
        } finally {
          // Cleanup if error before setTimeout
          if (!succeeded) {
            clearInterval(msgInterval);
          }
        }
      });
    }


    /* ========== 07.9 SAVE LEAD (async helper) ========== */
    async function saveLeadAsync(payload) {
      if (!API_ENABLED) return;

      try {
        const referrerCode = getStoredReferralCode();

        const res = await fetch(API_BASE + '/api/save-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: payload.name,
            age: payload.age,
            savings: payload.savings,
            carModel: payload.carModel,
            referrerCode: referrerCode || undefined,
          }),
          keepalive: true,
        });

        if (!res.ok) return;

        const data = await res.json().catch(function () { return {}; });

        // Update referral link with backend-generated code
        if (data && data.referralCode) {
          updateReferralLink(data.referralCode, payload.name);
          // Clear stored referrer (user has been attributed)
          clearStoredReferralCode();
        }
      } catch (_) {
        /* silent — save-lead is non-critical */
      }
    }
        /* ========== 07.10 WHATSAPP LEAD FORM ========== */
    const whatsappLeadForm = $('whatsappLeadForm');
    const whatsappSuccessMsg = $('whatsappSuccessMsg');
    const whatsappErrorMsg = $('whatsappErrorMsg');

    if (whatsappLeadForm) {
      whatsappLeadForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        if (whatsappSuccessMsg) whatsappSuccessMsg.style.display = 'none';
        if (whatsappErrorMsg) whatsappErrorMsg.style.display = 'none';

        const rawName = String(($('whatsappName') || {}).value || '').trim();
        const rawPhone = String(($('whatsappPhone') || {}).value || '').trim();

        const name = validateName(rawName);
        const phone = validatePhone(rawPhone);

        // Validate
        if (!name) {
          showWhatsAppError('Please enter a valid name (letters only, min 2 chars).');
          return;
        }
        if (!phone) {
          showWhatsAppError('Please enter a valid 10-digit Indian mobile number (starting with 6-9).');
          return;
        }

        // Get plan context
        const modelSelect = $('calcModel');
        const selectedOption = modelSelect
          ? modelSelect.options[modelSelect.selectedIndex]
          : null;
        const carModelDisplay = selectedOption
          ? selectedOption.textContent.split(' — ')[0].trim()
          : 'BMW';

        // Target year (from timeline element)
        let targetYear = new Date().getFullYear() + 2;
        const timelineEl = $('valTimelineMsg');
        if (timelineEl && timelineEl.textContent) {
          const match = timelineEl.textContent.match(/\b(20\d{2})\b/);
          if (match) targetYear = parseInt(match[1], 10);
        }

        // Savings (from select)
        const savingsEl = $('calcSavings');
        const savings = savingsEl ? parseInt(savingsEl.value, 10) || 0 : 0;

        // Submit
        const submitBtn = $('whatsappSaveBtn');
        const originalText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) {
          submitBtn.textContent = 'Save ho raha hai...';
          submitBtn.disabled = true;
        }

        try {
          if (!API_ENABLED) throw new Error('Backend not configured');

          const res = await fetch(API_BASE + '/api/save-whatsapp-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name,
              phone: phone,
              carModel: carModelDisplay,
              targetYear: targetYear,
              savings: savings,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(function () { return {}; });
            throw new Error(errData.error || 'Save failed');
          }

          if (whatsappSuccessMsg) {
            whatsappSuccessMsg.textContent =
              'Save ho gaya! Hum aapko ' + targetYear +
              ' ke baare mein reminder bhejenge.';
            whatsappSuccessMsg.style.display = 'block';
          }

          whatsappLeadForm.reset();
          trackEvent('whatsapp_lead_save', { car_model: carModelDisplay });
        } catch (error) {
          const msg = (error && error.message) || 'Kuch gadbad ho gayi';
          showWhatsAppError(msg);
          console.error('WhatsApp lead error:', error);
        } finally {
          if (submitBtn) {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
          }
        }
      });
    }

    function showWhatsAppError(message) {
      if (!whatsappErrorMsg) return;
      whatsappErrorMsg.textContent = message;
      whatsappErrorMsg.style.display = 'block';
    }


    /* ========== 07.11 REFERRAL LINK UPDATE ========== */
    function updateReferralLink(referralCode, name) {
      const input = $('referralLink');
      const copyBtn = $('copyReferralBtn');
      const countEl = $('referralCount');
      if (!input || !copyBtn) return;

      const finalCode = referralCode || 'PENDING';
      const url = window.location.origin + '?ref=' + finalCode;
      input.value = url;
      input.setAttribute('data-code', finalCode);

      // Replace button (removes old listeners)
      const newBtn = copyBtn.cloneNode(true);
      copyBtn.parentNode.replaceChild(newBtn, copyBtn);

      newBtn.addEventListener('click', async function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(input.value);
          } else {
            input.select();
            document.execCommand('copy');
          }
          const orig = newBtn.textContent;
          newBtn.textContent = 'Copied! ✓';
          setTimeout(function () { newBtn.textContent = orig; }, 2000);
          trackEvent('referral_copy', { referrer_code: finalCode });
        } catch (_) {
          alert('Copy failed — please copy manually.');
        }
      });

      if (countEl && name) {
        countEl.textContent = 'Aapne abhi tak 0 logon ko refer kiya hai.';
      }
    }


    /* ========== 07.12 RESET / RECALC ========== */
    const recalcBtn = $('recalcBtn');
    if (recalcBtn && refs.planResultSection && refs.calculatorSection) {
      recalcBtn.addEventListener('click', function () {
        trackEvent('reset_click');
        refs.planResultSection.style.opacity = '0';
        setTimeout(function () {
          refs.planResultSection.hidden = true;
          refs.calculatorSection.style.display = 'grid';
          refs.calculatorSection.style.opacity = '1';
        }, 400);
      });
    }

    const resetFormLink = $('resetFormLink');
    if (resetFormLink && refs.planResultSection && refs.calculatorSection) {
      resetFormLink.addEventListener('click', function (e) {
        e.preventDefault();
        trackEvent('reset_click');
        refs.planResultSection.style.opacity = '0';
        setTimeout(function () {
          refs.planResultSection.hidden = true;
          refs.calculatorSection.style.display = 'grid';
          refs.calculatorSection.style.opacity = '1';
          if (refs.calcForm) refs.calcForm.reset();
          CALC_FIELDS.forEach(clearError);
          refs.calculatorSection.scrollIntoView({ behavior: 'smooth' });
        }, 400);
      });
    }


    /* ========== 07.13 WHATSAPP SHARE ========== */
    const shareWhatsAppBtn = $('shareWhatsAppBtn');
    if (shareWhatsAppBtn) {
      shareWhatsAppBtn.addEventListener('click', function () {
        const modelSelect = $('calcModel');
        const selectedOption = modelSelect
          ? modelSelect.options[modelSelect.selectedIndex]
          : null;
        const carDisplayName = selectedOption
          ? selectedOption.textContent.split(' — ')[0].trim()
          : 'BMW';

        const storedRef = getStoredReferralCode();
        const shareUrl = storedRef
          ? window.location.origin + '?ref=' + storedRef
          : window.location.origin;

        const message =
          'Maine abhi check kiya — meri ' + carDisplayName + ' ' +
          (new Date().getFullYear() + 2) +
          ' mein aa rahi hai! Tum bhi check karo: ' + shareUrl;

        trackEvent('whatsapp_share', { car_model: carDisplayName });

        const waUrl = 'https://wa.me/?text=' + encodeURIComponent(message);
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      });
    }


    /* ========== 07.14 AFFILIATE CLICK TRACKING ========== */
    document.querySelectorAll('[data-affiliate]').forEach(function (el) {
      el.addEventListener('click', function () {
        const partner = el.getAttribute('data-affiliate') || 'unknown';
        const modelSelect = $('calcModel');
        const selectedOption = modelSelect
          ? modelSelect.options[modelSelect.selectedIndex]
          : null;
        const carModel = selectedOption
          ? selectedOption.textContent.split(' — ')[0].trim()
          : '';
        trackEvent('affiliate_click', { partner: partner, car_model: carModel });
      });
    });
        /* ========== 07.15 RESULT RENDERING (XSS-safe) ========== */
    function renderResult(plan) {
      if (!refs.planResultSection) return;
      if (!plan || typeof plan !== 'object') return;

      // Derive display name (safe)
      const modelSelect = $('calcModel');
      const selectedOption = modelSelect
        ? modelSelect.options[modelSelect.selectedIndex]
        : null;
      const carDisplayName = selectedOption
        ? selectedOption.textContent.split(' — ')[0].trim()
        : String(plan.carModel || 'BMW');

      // === Heading ===
      setText(
        'planHeading',
        plan.name + ' ji, aapki ' + carDisplayName + ' ka plan yeh hai'
      );

      // === Card 1: Kitna Chahiye ===
      setText('valCarPrice', formatINR(plan.carPrice));
      setText('valDownPayment', formatINR(plan.downPayment));
      setText('valLoanAmount', formatINR(plan.loanAmount));
      setText('valEmi', '₹' + formatNumber(plan.emi) + '/mahina');

      // === Card 2: Timeline ===
      setText('valSavings', '₹' + formatNumber(plan.savings) + '/mahina');
      setText('valYears', plan.yearsNeeded + ' saal');
      setText(
        'valTimelineMsg',
        'Matlab ' + plan.targetYear + ' mein aap ' + carDisplayName +
        ' ke liye down payment kar sakte hain.'
      );

      // === Card 3: Tip ===
      const tipEl = $('valTip');
      if (tipEl) {
        if (Number(plan.yearsNeeded) > 5) {
          const newSavings = (Number(plan.savings) || 0) + 5000;
          const newYears = newSavings > 0
            ? Math.round((Number(plan.downPayment) / (newSavings * 12)) * 10) / 10
            : plan.yearsNeeded;
          tipEl.textContent =
            'Agar aap bachat ₹5,000 badha dein, toh timeline ' +
            newYears + ' saal ho jayega.';
        } else {
          tipEl.textContent = 'Aap sahi raste par hain! Mehnat jaari rakhein. 🎉';
        }
      }

      // === Progress bar ===
      setText('valDownPaymentTarget', formatINR(plan.downPayment));
      const progressFill = $('progressFill');
      if (progressFill) {
        progressFill.style.width = '0%';
        // Defer to next frame for smooth transition
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            progressFill.style.width = '100%';
          });
        });
      }

      // === Show section with fade ===
      refs.planResultSection.hidden = false;
      refs.planResultSection.style.opacity = '0';
      refs.planResultSection.style.transition = 'opacity 0.5s ease';
      window.requestAnimationFrame(function () {
        refs.planResultSection.style.opacity = '1';
      });

      // === Analytics ===
      trackEvent('result_view', { car_model: plan.carModel });

      // === Referral link (placeholder — will update after save-lead) ===
      updateReferralLink(null, plan.name);

      // === Update OG meta tags for social sharing ===
      try {
        const ogTitle = $('og-title');
        const ogDesc = $('og-desc');
        if (ogTitle) {
          ogTitle.setAttribute(
            'content',
            plan.name + ' ki BMW ' + carDisplayName + ' ' +
            plan.targetYear + ' mein aa rahi hai!'
          );
        }
        if (ogDesc) {
          ogDesc.setAttribute(
            'content',
            'Maine abhi calculate kiya — tum bhi apna plan check karo.'
          );
        }
      } catch (_) {
        /* silent */
      }
    }


    /* ========== 07.16 VALIDATION ========== */
    function validateCalcForm() {
      let isValid = true;

      // Name
      const nameVal = String(($('calcName') || {}).value || '').trim();
      if (!nameVal) {
        showError('calcName', 'Naam darj karein.');
        isValid = false;
      } else if (nameVal.length < 2) {
        showError('calcName', 'Naam kam se kam 2 akshar ka hona chahiye.');
        isValid = false;
      } else if (!NAME_REGEX.test(nameVal)) {
        showError('calcName', 'Naam mein sirf akshar aur space hone chahiye.');
        isValid = false;
      }

      // Age
      const ageVal = parseInt(($('calcAge') || {}).value, 10);
      if (isNaN(ageVal) || ageVal < 18 || ageVal > 80) {
        showError('calcAge', 'Umar 18 se 80 ke beech honi chahiye.');
        isValid = false;
      }

      // Savings
      if (!($('calcSavings') || {}).value) {
        showError('calcSavings', 'Mahine ki bachat select karein.');
        isValid = false;
      }

      // Model
      if (!($('calcModel') || {}).value) {
        showError('calcModel', 'BMW model select karein.');
       