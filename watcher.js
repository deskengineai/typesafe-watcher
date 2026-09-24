// Hourly check: try to sign up at console.typesafe.ai with Google (account from GOOGLE_EMAIL in .env).
// Uses the bsk CLI (browser-skill) in a background Agent Window of the logged-in Chrome.
// Stops retrying once signup succeeds.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
const LOGIN_URL = 'https://console.typesafe.ai/login';
const INTERVAL_MS = 60 * 60 * 1000;
const SUCCESS_FILE = path.join(__dirname, 'SUCCESS.txt');
const BSK = process.env.BSK_PATH || path.join(process.env.USERPROFILE || '', '.local', 'bin', 'bsk.exe');

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bsk(args, timeout = 60000) {
  return execFileSync(BSK, args, { encoding: 'utf8', timeout, windowsHide: true });
}

function findRef(observation, pattern) {
  for (const line of observation.split('\n')) {
    const m = line.match(/(@e\d+)\s+(\w+)\s+"([^"]*)"/);
    if (m && pattern.test(m[3])) return m[1];
  }
  return null;
}

// Returns 'full' | 'success' | 'unknown'
async function attempt() {
  const start = JSON.parse(bsk(['session', 'start', '--no-focus', '--json']));
  const s = start.session_id;
  const run = (args, t) => bsk([...args, '--session', s], t);
  const url = () => run(['evaluate', 'location.href']).trim();
  const bodyText = () => run(['evaluate', 'document.body.innerText']);

  try {
    run(['navigate', LOGIN_URL]);
    await sleep(3000);

    // Already logged in from a previous run -> login page redirects into the console.
    if (!url().includes('/login')) return 'success';

    const googleRef = findRef(run(['observe']), /Continue with Google/i);
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
        const obs = run(['observe']);
        const acct = findRef(obs, new RegExp(EMAIL.replace(/\./g, '\\.'), 'i'));
        const cont = findRef(obs, /^(Continue|Allow)$/i);
        if (acct) { log('choosing Google account', EMAIL.replace(/^(.).*(@.*)$/, '$1***$2')); run(['click', acct]); }
        else if (cont) { log('clicking Google consent:', cont); run(['click', cont]); }
        continue;
      }
      if (u.includes('console.typesafe.ai')) {
        const text = bodyText();
        if (/signups_disabled/i.test(u) || /we.?re full/i.test(text)) return 'full';
        const p = new URL(u).pathname;
        if (!p.startsWith('/login') && !p.startsWith('/auth')) {
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
