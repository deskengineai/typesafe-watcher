// Pure helpers used by watcher.js. No browser or network access here, so they can be unit tested.
const fs = require('fs');

// Most "Notify me" / waitlist submissions the watcher will ever make, across restarts.
const MAX_NOTIFY = 2;

// Finds the first `@eN` ref in `bsk observe` output whose label matches `pattern`,
// optionally limited to one role (e.g. 'button', 'textbox').
function findRef(observation, pattern, role) {
  for (const line of observation.split('\n')) {
    const m = line.match(/(@e\d+)\s+(\w+)\s+"([^"]*)"/);
    if (m && (!role || m[2] === role) && pattern.test(m[3])) return m[1];
  }
  return null;
}

// "Sorry, new signups are paused" (console) or "NEW SIGNUPS PAUSED" (homepage).
function isSignupsPaused(text) {
  return /new signups (are )?paused/i.test(text || '');
}

// Classifies a page on console.typesafe.ai after the Google redirect.
// Returns 'full' | 'paused' | 'site-error' | 'success' | null (null = still redirecting / keep polling).
// 'site-error' is TypeSafe's own "Sign-in hit an unexpected error" page (seen with HTTP 429 rate limits).
function classifyConsole(url, text) {
  if (/signups_disabled/i.test(url) || /we.?re full/i.test(text || '')) return 'full';
  if (isSignupsPaused(text)) return 'paused';
  if (/sign-in hit an unexpected error/i.test(text || '')) return 'site-error';
  const p = new URL(url).pathname;
  if (!p.startsWith('/login') && !p.startsWith('/auth')) return 'success';
  return null;
}

function maskEmail(email) {
  return email.replace(/^(.).*(@.*)$/, '$1***$2');
}

function readNotifyState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { count: Number(s.count) || 0, times: Array.isArray(s.times) ? s.times : [] };
  } catch (e) {
    return { count: 0, times: [] };
  }
}

function canNotify(state) {
  return state.count < MAX_NOTIFY;
}

function recordNotify(file, now = new Date()) {
  const s = readNotifyState(file);
  const next = { count: s.count + 1, times: [...s.times, now.toISOString()] };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = {
  MAX_NOTIFY, findRef, isSignupsPaused, classifyConsole, maskEmail,
  readNotifyState, canNotify, recordNotify,
};
