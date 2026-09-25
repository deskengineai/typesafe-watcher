// Hourly check: try to sign up at console.typesafe.ai with Google (account from GOOGLE_EMAIL in .env).
// Uses the bsk CLI (browser-skill) in a background Agent Window of the logged-in Chrome.
// If a "signups are paused" form shows up, submits the email to it (at most MAX_NOTIFY times ever).
// Stops retrying once signup succeeds.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  MAX_NOTIFY, findRef, isSignupsPaused, classifyConsole, maskEmail,
  readNotifyState, canNotify, recordNotify,
} = require('./lib');

// Minimal .env loader (KEY=value lines) so there are no dependencies.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const EMAIL = process.env.GOOGLE_EMAIL;
if (!EMAIL) {
  console.error('GOOGLE_EMAIL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
const HOME_URL = 'https://typesafe.ai/';
const LOGIN_URL = 'https://console.typesafe.ai/login';
const INTERVAL_MS = 60 * 60 * 1000;
const SUCCESS_FILE = path.join(__dirname, 'SUCCESS.txt');
const NOTIFY_FILE = path.join(__dirname, 'notify-state.json');
const BSK = process.env.BSK_PATH || path.join(process.env.USERPROFILE || '', '.local', 'bin', 'bsk.exe');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bsk(args, timeout = 60000) {
  return execFileSync(BSK, args, { encoding: 'utf8', timeout, windowsHide: true });
}

// Returns 'full' | 'paused' | 'site-error' | 'success' | 'unknown'
async function attempt() {
  const start = JSON.parse(bsk(['session', 'start', '--no-focus', '--json']));
  const s = start.session_id;
  const run = (args, t) => bsk([...args, '--session', s], t);
  const url = () => run(['evaluate', 'location.href']).trim();
  const bodyText = () => run(['evaluate', 'document.body.innerText']);
  // Pages keep re-rendering while they load, so `observe` can fail ("Document changed
  // during observation") or run before the control exists. Re-observe until it shows up.
  const waitForRef = async (pattern, role, tries = 10) => {
    for (let i = 0; i < tries; i++) {
      try {
        const ref = findRef(run(['observe']), pattern, role);
        if (ref) return ref;
      } catch (e) { /* page still changing; observe again */ }
      await sleep(2000);
    }
    return null;
  };

  // Fills the "signups paused" form on the current page and clicks Notify me / Submit.
  // Counts toward MAX_NOTIFY once the button is clicked, whether or not the site confirms it.
  const submitWaitlist = async () => {
    if (!canNotify(readNotifyState(NOTIFY_FILE))) return;
    // Refs go stale whenever the page re-renders (typing into the box does it),
    // so look each control up right before using it and retry on a stale ref.
    const act = async (pattern, role, args) => {
      for (let i = 0; i < 5; i++) {
        const ref = await waitForRef(pattern, role);
        if (!ref) return false;
        try { run([args[0], ref, ...args.slice(1)]); return true; } catch (e) { await sleep(1000); }
      }
      return false;
    };
    try {
      if (!await act(/@|e-?mail/i, 'textbox', ['fill', '--value', EMAIL])) {
        log('signups-paused form found but its email box was not'); return;
      }
      if (!await act(/^(notify me|submit)$/i, 'button', ['click'])) {
        log('signups-paused form found but its Notify me / Submit button was not'); return;
      }
    } catch (e) {
      log('notify-me failed:', e.message); return;
    }
    const st = recordNotify(NOTIFY_FILE);
    await sleep(3000);
    let after = '';
    try { after = bodyText().replace(/\s+/g, ' ').slice(0, 160); } catch (e) { /* page changing */ }
    log(`notify-me submitted for ${maskEmail(EMAIL)} (${st.count}/${MAX_NOTIFY}); page now: ${after}`);
  };

  try {
    // Homepage waitlist form ("NEW SIGNUPS PAUSED"), only while submissions remain.
    // A problem here must not skip the signup check below.
    if (canNotify(readNotifyState(NOTIFY_FILE))) try {
      run(['navigate', HOME_URL]);
      await sleep(3000);
      let homeText = '';
      for (let i = 0; i < 10 && !isSignupsPaused(homeText); i++) {
        try { homeText = bodyText(); } catch (e) { /* still loading */ }
        if (!isSignupsPaused(homeText)) await sleep(2000);
      }
      if (isSignupsPaused(homeText)) { log('homepage says signups are paused'); await submitWaitlist(); }
    } catch (e) { log('homepage check failed:', e.message); }

    run(['navigate', LOGIN_URL]);
    await sleep(3000);

    // Already logged in from a previous run -> login page redirects into the console.
    if (!url().includes('/login')) return 'success';

    // The console may show the paused page instead of the login form.
    if (isSignupsPaused(bodyText())) { await submitWaitlist(); return 'paused'; }

    const googleRef = await waitForRef(/Continue with Google/i, 'button');
    if (!googleRef) throw new Error('"Continue with Google" button not found');
    run(['click', googleRef]);

    // Walk through Google's account chooser / consent, then wait for the redirect back.
    // /auth/callback is an intermediate hop that redirects to /login?error=... when full,
    // so success needs a non-login, non-auth console page on two polls in a row.
    let successHits = 0;
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      const u = url();
      if (u.includes('accounts.google.com')) {
        let obs;
        try { obs = run(['observe']); } catch (e) { continue; } // page still changing
        const acct = findRef(obs, new RegExp(EMAIL.replace(/\./g, '\\.'), 'i'));
        const cont = findRef(obs, /^(Continue|Allow)$/i);
        if (acct) { log('choosing Google account', maskEmail(EMAIL)); try { run(['click', acct]); } catch (e) { /* stale ref; retry next poll */ } }
        else if (cont) { log('clicking Google consent:', cont); try { run(['click', cont]); } catch (e) { /* stale ref; retry next poll */ } }
        continue;
      }
      if (u.includes('console.typesafe.ai')) {
        const result = classifyConsole(u, bodyText());
        if (result === 'full' || result === 'site-error') return result;
        if (result === 'paused') { await submitWaitlist(); return 'paused'; }
        if (result === 'success') {
          if (++successHits >= 2) { log('landed on', u); return 'success'; }
          continue;
        }
      }
      successHits = 0;
    }
    log('ended on', url());
    return 'unknown';
  } finally {
    try { bsk(['session', 'stop', s]); } catch (e) { log('session stop failed:', e.message); }
  }
}

function notify(msg) {
  // Non-blocking popup so the success is visible even if nobody reads the logs.
  spawn('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${msg}','TypeSafe watcher')`],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function main() {
  if (fs.existsSync(SUCCESS_FILE)) {
    log('SUCCESS.txt exists - signup already done. Idling. Delete SUCCESS.txt to resume checks.');
    return setInterval(() => {}, INTERVAL_MS);
  }
  while (true) {
    let result;
    try { result = await attempt(); } catch (e) { result = 'error'; log('attempt error:', e.message); }
    log('result:', result);
    if (result === 'success') {
      fs.writeFileSync(SUCCESS_FILE, `TypeSafe signup succeeded at ${new Date().toISOString()} for ${EMAIL}\n`);
      notify(`TypeSafe signup succeeded for ${EMAIL}!`);
      log('Done - stopping hourly checks.');
      return setInterval(() => {}, INTERVAL_MS);
    }
    log(`next check in 60 min`);
    await sleep(INTERVAL_MS);
  }
}

main();
