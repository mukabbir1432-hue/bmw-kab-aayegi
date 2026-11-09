/* =====================================================================
   BMW KAB AAYEGI? — SERVICE WORKER
   =====================================================================
   File     : sw.js
   Version  : 3.0.0
   Purpose  : Offline support + fast repeat visits

   CONNECTIONS
   ─────────────────────────────────────────────────────────────────────
   • index.html        → navigator.serviceWorker.register('/sw.js')
   • style.css         → cached on install
   • script.js         → cached on install
   • config.js         → cached on install
   • /assets/*         → cached on first fetch (runtime)
   • /api/*            → never cached (always network)

   SECURITY
   ─────────────────────────────────────────────────────────────────────
   • Only same-origin GET requests cached (prevents cache poisoning)
   • API endpoints (/api/*) always bypass cache
   • Admin routes (/admin.html) never cached
   • Auth headers stripped before cache (never store credentials)
   • Cache version bumped via CACHE_VERSION constant

   STRATEGIES
   ─────────────────────────────────────────────────────────────────────
   • Navigation (HTML)     → Network-first, fallback to cache
   • Static (CSS/JS/img)   → Stale-while-revalidate
   • API                   → Network only (never cache)
   • Cross-origin          → Network only (never cache)
   ===================================================================== */

'use strict';

/* ---------------------------------------------------------------------
   01. CONFIGURATION
   --------------------------------------------------------------------- */

// ⚠️ BUMP THIS when CSS/JS changes to force cache refresh
// Format: vYYYYMMDD-HHMM (e.g., v20260115-1430)
const CACHE_VERSION = 'v20260115-0001';
const CACHE_PREFIX = 'bmw-kab-aayegi-';

// Two caches: static (long-lived) + runtime (short-lived)
const CACHE_NAMES = {
  STATIC: CACHE_PREFIX + 'static-' + CACHE_VERSION,
  RUNTIME: CACHE_PREFIX + 'runtime-' + CACHE_VERSION,
};

// Files to precache on install (must all exist or install fails)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/config.js',
  '/assets/og-image.jpg',
];

// Never cache these paths (security / staleness)
const NEVER_CACHE_PATTERNS = [
  /^\/api\//,                    // API endpoints
  /^\/admin/,                    // Admin dashboard
  /^\/sw\.js$/,                  // Self (avoid stale SW)
  /^\/manifest\.json$/,          // Manifest (should be fresh)
];

// Only cache these origins (same-origin only)
const ALLOWED_ORIGIN = self.location.origin;


/* ---------------------------------------------------------------------
   02. SECURITY HELPERS
   --------------------------------------------------------------------- */

/**
 * Check if a URL should be cached.
 * Returns true only for same-origin GET requests to safe paths.
 */
function isCacheable(request) {
  // Only GET requests
  if (request.method !== 'GET') return false;

  // Only same-origin (prevents cache poisoning from third parties)
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return false;
  }
  if (url.origin !== ALLOWED_ORIGIN) return false;

  // Never cache sensitive paths
  for (let i = 0; i < NEVER_CACHE_PATTERNS.length; i++) {
    if (NEVER_CACHE_PATTERNS[i].test(url.pathname)) return false;
  }

  // Never cache requests with auth headers
  if (request.headers.has('Authorization')) return false;
  if (request.headers.has('X-Admin-Password')) return false;

  // Only http(s) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  return true;
}

/**
 * Check if request is a navigation (HTML page).
 */
function isNavigation(request) {
  return request.mode === 'navigate';
}

/**
 * Check if request is a static asset (CSS, JS, image, font).
 */
function isStaticAsset(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return [
    'css', 'js', 'mjs',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
  ].indexOf(ext) !== -1;
}
/* ---------------------------------------------------------------------
   03. INSTALL EVENT
   ---------------------------------------------------------------------
   Runs when a NEW service worker is detected.
   1. Open static cache
   2. Precache all PRECACHE_URLS
   3. Force activation (skipWaiting) — don't wait for tabs to close
   
   If ANY precache URL fails, install fails and old SW stays active.
   This prevents broken deploys.
   --------------------------------------------------------------------- */

self.addEventListener('install', function (event) {
  console.log('[SW] Install event — version:', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAMES.STATIC).then(function (cache) {
      console.log('[SW] Precaching', PRECACHE_URLS.length, 'URLs');

      // Use addAll — fails atomically if ANY URL 404s
      return cache.addAll(PRECACHE_URLS).then(function () {
        console.log('[SW] Precache complete');
        // ✅ Force new SW to activate immediately (no waiting)
        return self.skipWaiting();
      });
    }).catch(function (err) {
      console.error('[SW] Precache failed:', err);
      // Don't skipWaiting — old SW stays active (safer)
      throw err;
    })
  );
});
/* ---------------------------------------------------------------------
   04. ACTIVATE EVENT
   ---------------------------------------------------------------------
   Runs after install (or after old SW releases control).
   1. Delete old caches (anything with old version)
   2. Claim all clients (control existing tabs immediately)
   --------------------------------------------------------------------- */

self.addEventListener('activate', function (event) {
  console.log('[SW] Activate event — version:', CACHE_VERSION);

  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      // Delete caches that don't match current version
      const deletions = cacheNames
        .filter(function (name) {
          // Only touch our caches
          if (name.indexOf(CACHE_PREFIX) !== 0) return false;
          // Keep current static + runtime
          return name !== CACHE_NAMES.STATIC && name !== CACHE_NAMES.RUNTIME;
        })
        .map(function (name) {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        });

      return Promise.all(deletions);
    }).then(function () {
      console.log('[SW] Old caches cleaned');
      // ✅ Take control of all existing tabs (no reload needed)
      return self.clients.claim();
    }).then(function () {
      console.log('[SW] Clients claimed — SW is now active');
    })
  );
});
/* ---------------------------------------------------------------------
   05. FETCH EVENT — STRATEGY ROUTER
   ---------------------------------------------------------------------
   Routes each request to the right caching strategy.
   --------------------------------------------------------------------- */

self.addEventListener('fetch', function (event) {
  const request = event.request;

  // === Security guard: never cache sensitive requests ===
  if (!isCacheable(request)) {
    // Let browser handle it (network only)
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }

  // === Navigation (HTML pages) → Network-first ===
  if (isNavigation(request)) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // === Static assets → Stale-while-revalidate ===
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // === Everything else → Network, fallback to cache ===
  event.respondWith(networkWithCacheFallback(request));
});


/* ---------------------------------------------------------------------
   06. CACHE STRATEGIES
   --------------------------------------------------------------------- */

/**
 * Network-first for HTML pages.
 * Always tries network first; if offline, uses cached HTML.
 * Reason: HTML changes frequently and should be fresh.
 */
async function networkFirstHTML(request) {
  try {
    const networkResponse = await fetch(request);

    // Only cache successful responses
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAMES.RUNTIME);
      // Clone — response body can only be read once
      cache.put(request, networkResponse.clone()).catch(function () {});
    }

    return networkResponse;
  } catch (err) {
    // Network failed — try cache
    const cached = await caches.match(request);
    if (cached) return cached;

    // Nothing cached — return offline page
    return offlineFallback();
  }
}

/**
 * Stale-while-revalidate for static assets.
 * Returns cached version immediately (fast), updates cache in background.
 * Reason: CSS/JS/images change rarely; speed matters most.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAMES.RUNTIME);
  const cached = await cache.match(request);

  // Start network fetch (don't await)
  const fetchPromise = fetch(request)
    .then(function (networkResponse) {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone()).catch(function () {});
      }
      return networkResponse;
    })
    .catch(function () {
      // Network failed — nothing to update
      return null;
    });

  // Return cached immediately if available; otherwise wait for network
  return cached || fetchPromise || offlineFallback();
}

/**
 * Network with cache fallback.
 * For anything not covered by the above strategies.
 */
async function networkWithCacheFallback(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback();
  }
}

/**
 * Offline fallback — returns cached index.html or a minimal HTML page.
 */
async function offlineFallback() {
  const cached = await caches.match('/index.html');
  if (cached) return cached;

  // Minimal inline offline page
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline — BMW Kab Aayegi?</title>' +
    '<style>body{font-family:Poppins,sans-serif;display:flex;align-items:center;' +
    'justify-content:center;height:100vh;margin:0;background:#f8f9fa;color:#1a1a1a;' +
    'text-align:center;padding:20px}.box{max-width:400px}h1{color:#0066B1}' +
    'a{color:#FF6B00;font-weight:600}</style></head><body>' +
    '<div class="box"><h1>📡 Offline</h1>' +
    '<p>Aap offline hain. Kripya internet connection check karein.</p>' +
    '<p><a href="/">Retry →</a></p></div></body></html>',
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
}
/* ---------------------------------------------------------------------
   07. MESSAGE HANDLER (manual update trigger from main thread)
   ---------------------------------------------------------------------
   Frontend can call: navigator.serviceWorker.controller.postMessage({
     type: 'SKIP_WAITING' | 'CLEAR_CACHE' | 'VERSION'
   })
   --------------------------------------------------------------------- */

self.addEventListener('message', function (event) {
  const data = event.data || {};
  const type = data.type;

  switch (type) {
    case 'SKIP_WAITING':
      // Force new SW to activate (triggered by user clicking "update")
      console.log('[SW] SKIP_WAITING received');
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      // Clear all caches (triggered by "clear cache" button)
      event.waitUntil(
        caches.keys().then(function (names) {
          return Promise.all(names.map(function (name) {
            if (name.indexOf(CACHE_PREFIX) === 0) {
              console.log('[SW] Clearing cache:', name);
              return caches.delete(name);
            }
            return Promise.resolve();
          }));
        }).then(function () {
          if (event.ports[0]) {
            event.ports[0].postMessage({ success: true });
          }
        })
      );
      break;

    case 'VERSION':
      // Frontend asks for current version
      if (event.ports[0]) {
        event.ports[0].postMessage({ version: CACHE_VERSION });
      }
      break;

    default:
      // Unknown message — ignore
      break;
  }
});


/* ---------------------------------------------------------------------
   08. SELF-UPDATE (registration update check)
   ---------------------------------------------------------------------
   When frontend registers SW, it can pass `{ updateViaCache: 'none' }`
   to always check network. SW itself can also self-trigger update checks.
   --------------------------------------------------------------------- */

self.addEventListener('sync', function (event) {
  // Background sync (future: retry failed lead submissions)
  if (event.tag === 'retry-leads') {
    // Reserved for future use — no implementation yet
  }
});


/* ---------------------------------------------------------------------
   09. ERROR HANDLING
   ---------------------------------------------------------------------
   Catch uncaught errors in SW context — log but don't crash.
   --------------------------------------------------------------------- */

self.addEventListener('error', function (event) {
  console.error('[SW] Uncaught error:', event.message);
});

self.addEventListener('unhandledrejection', function (event) {
  console.error('[SW] Unhandled rejection:', event.reason);
});


/* ---------------------------------------------------------------------
   10. INIT LOG
   --------------------------------------------------------------------- */
console.log('[SW] Loaded. Version:', CACHE_VERSION);
console.log('[SW] Static cache:', CACHE_NAMES.STATIC);
console.log('[SW] Runtime cache:', CACHE_NAMES.RUNTIME);