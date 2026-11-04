// ─────────────────────────────────────────────────────────────
//  Tatshan settings. This is the only file you need to edit.
// ─────────────────────────────────────────────────────────────

// Paste your Firebase web-app config here (Firebase console → Project settings →
// Your apps → Web app → "Config"). These values are NOT secrets; your security
// comes from firestore.rules.
//
// While apiKey still starts with "YOUR_", Tatshan runs in DEMO MODE: everything
// works, but only between tabs of the same browser. Handy for trying the UI.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA6-HcChtcwLYV6yoR0VG5FycMThgRGjjc',
  authDomain: 'tatshan-fd029.firebaseapp.com',
  projectId: 'tatshan-fd029',
  storageBucket: 'tatshan-fd029.firebasestorage.app', // not used; safe to leave
  messagingSenderId: '565190787278',
  appId: '1:565190787278:web:d5e9153670f7ae0396d09f',
};

// Firebase JS SDK version, loaded straight from Google's CDN (no npm, no build).
export const FIREBASE_VERSION = '13.1.0';

export const SETTINGS = {
  // Files (and inboxes) vanish this many hours after they're sent.
  // If you change it, change the 6-hour checks in firestore.rules too.
  EXPIRY_HOURS: 6,

  MAX_FILES_PER_SEND: 10,
  MAX_FILE_MB: 10, // files live in Firestore (free plan): keep them small. Rules allow ~700 KB pieces.

  // Print-shop history stays on the shop's own device for this long, then is wiped.
  HISTORY_KEEP_HOURS: 48,

  // The pigeon artwork. To use a licensed photo instead, drop it into /assets
  // (e.g. assets/pigeon.png) and change this path. Nothing else needs to change.
  PIGEON_SRC: 'assets/pigeon.svg',
};

export const isConfigured = () => !String(FIREBASE_CONFIG.apiKey).startsWith('YOUR_');
