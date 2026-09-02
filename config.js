// Runbook: point this at the founder's deployed FastAPI server (server/) to
// switch the app from the browser's built-in (interim) speech recognition to
// real server-side ASR + accounts/progress-sync. Leave empty for guest-only,
// fully-client-side operation (Web Speech API + typed fallback, no accounts).
//
// Example once a server is deployed:
//   window.TASME3_CONFIG = { SERVER_URL: 'https://api.tasme3.example.com' };
//
// No trailing slash. The app appends '/evaluate', '/account', '/progress'.
window.TASME3_CONFIG = {
  SERVER_URL: ''
};
