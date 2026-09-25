const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MAX_NOTIFY, findRef, isSignupsPaused, classifyConsole, maskEmail,
  readNotifyState, canNotify, recordNotify,
} = require('../lib');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-watcher-')), 'notify-state.json');

// Trimmed real `bsk observe` output from the typesafe.ai homepage.
const HOME_OBS = `
    group
      @e8 button "NEW SIGNUPS PAUSED"
      @e9 button "Leave your email and we'll let you know when signups reopen"
    form "Already signed up? You can still"
      @e10 textbox "jev@intelligence.ai" [empty] placeholder="jev@intelligence.ai"
      @e11 button "Submit"
      @e12 link "log in" [→ console.typesafe.ai]`;

// The wording from the console's paused page.
const CONSOLE_PAUSED_OBS = `
    heading "Sorry, new signups are paused"
    paragraph "Please submit your email below and we'll let you know when signups reopen"
    @e3 textbox "Email" [empty]
    @e4 button "Notify me"`;

test('isSignupsPaused matches both wordings', () => {
  assert.equal(isSignupsPaused('Sorry, new signups are paused\n\nPlease submit your email below'), true);
  assert.equal(isSignupsPaused('TypeSafe News NEW SIGNUPS PAUSED Leave your email'), true);
});

test('isSignupsPaused ignores the full page and normal pages', () => {
  assert.equal(isSignupsPaused("Whoops, we're full - check https://x.com/typesafeai"), false);
  assert.equal(isSignupsPaused('Welcome to TypeSafe Continue with Google'), false);
  assert.equal(isSignupsPaused(''), false);
  assert.equal(isSignupsPaused(undefined), false);
});

test('findRef finds the waitlist email box and button on the homepage', () => {
  assert.equal(findRef(HOME_OBS, /@|e-?mail/i, 'textbox'), '@e10');
  assert.equal(findRef(HOME_OBS, /^(notify me|submit)$/i, 'button'), '@e11');
});

test('findRef finds the Notify me button on the console paused page', () => {
  assert.equal(findRef(CONSOLE_PAUSED_OBS, /@|e-?mail/i, 'textbox'), '@e3');
  assert.equal(findRef(CONSOLE_PAUSED_OBS, /^(notify me|submit)$/i, 'button'), '@e4');
});

test('findRef respects the role filter and returns null when nothing matches', () => {
  assert.equal(findRef(HOME_OBS, /log in/i, 'button'), null);
  assert.equal(findRef(HOME_OBS, /log in/i, 'link'), '@e12');
  assert.equal(findRef(HOME_OBS, /Continue with Google/i), null);
});

test('classifyConsole: full, paused, site-error, success, still redirecting', () => {
  assert.equal(classifyConsole('https://console.typesafe.ai/login?error=signups_disabled', ''), 'full');
  assert.equal(classifyConsole('https://console.typesafe.ai/login', "Whoops, we're full"), 'full');
  assert.equal(classifyConsole('https://console.typesafe.ai/login', 'Sorry, new signups are paused'), 'paused');
  assert.equal(classifyConsole('https://console.typesafe.ai/auth/callback?x=1', 'Loading'), null);
  assert.equal(classifyConsole('https://console.typesafe.ai/login', 'Welcome to TypeSafe'), null);
  assert.equal(classifyConsole('https://console.typesafe.ai/dashboard', 'Welcome back'), 'success');
  assert.equal(classifyConsole('https://console.typesafe.ai/login',
    'Something went wrong Sign-in hit an unexpected error. Try again'), 'site-error');
});

test('maskEmail hides everything but the first letter and domain', () => {
  assert.equal(maskEmail('someone@example.com'), 's***@example.com');
});

test('notify count starts at 0 when there is no state file', () => {
  const file = tmpFile();
  assert.deepEqual(readNotifyState(file), { count: 0, times: [] });
  assert.equal(canNotify(readNotifyState(file)), true);
});

test(`notify-me is allowed ${MAX_NOTIFY} times, then blocked`, () => {
  assert.equal(MAX_NOTIFY, 2);
  const file = tmpFile();
  recordNotify(file, new Date('2026-09-25T10:00:00Z'));
  assert.equal(canNotify(readNotifyState(file)), true);
  recordNotify(file, new Date('2026-09-25T11:00:00Z'));
  const s = readNotifyState(file);
  assert.equal(s.count, 2);
  assert.deepEqual(s.times, ['2026-09-25T10:00:00.000Z', '2026-09-25T11:00:00.000Z']);
  assert.equal(canNotify(s), false);
});

test('a corrupt state file counts as zero instead of crashing', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(readNotifyState(file), { count: 0, times: [] });
});
