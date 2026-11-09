// Backend API configuration
// Change this URL to your production backend (e.g., Render.com URL)
// For local development, use http://localhost:5000
const CONFIG = {
  BACKEND_URL: window.location.origin, // defaults to current origin (same domain)
  // BACKEND_URL: 'http://localhost:5000',     // uncomment for local dev with separate backend
  // BACKEND_URL: 'https://your-app.onrender.com', // uncomment for production
};

window.CONFIG = CONFIG;