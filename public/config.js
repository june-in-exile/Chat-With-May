// API backend URL — empty string means same origin (for Vercel deployment)
if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  window.__API_BASE = '';
}
