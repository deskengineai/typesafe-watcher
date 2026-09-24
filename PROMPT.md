# Prompt: TypeSafe signup watcher

Paste this into Claude Code (with the `browser-skill` / `bsk` extension installed and Chrome signed in to your Google account) to rebuild this project from scratch.

---

Use the browser-skill (`bsk` CLI) in a **background** Agent Window of my logged-in Chrome.

Goal: create an account at https://typesafe.ai/ using **"Continue with Google"** with the Google account in `GOOGLE_EMAIL` (read from a `.env` file, never hard-code it).

1. Run the flow once by hand first so we know it works:
   - Open `https://console.typesafe.ai/login` (the site's "Sign In" link).
   - Click "Continue with Google", choose the `GOOGLE_EMAIL` account in Google's account chooser, and click Continue/Allow if a consent screen appears.
   - Report where it lands.
2. Build a Node.js script (`watcher.js`, no dependencies) that repeats that flow **every hour** through the `bsk` CLI:
   - Start a session with `bsk session start --no-focus --json`, always `bsk session stop` it afterwards, even on error.
   - Find buttons and links by their text in `bsk observe` output (`@eN` refs), never with hard-coded refs.
   - **Still full:** the URL has `?error=signups_disabled` or the page says something like *"Whoops, we're full - check https://x.com/typesafeai for more information!"*. Log it and try again in 60 minutes.
   - **Success:** a `console.typesafe.ai` page that is not `/login` or `/auth/*`, seen on 2 checks in a row. `/auth/callback` is only a redirect on the way, so it is not success. Write `SUCCESS.txt`, show a Windows popup and stop checking.
   - If `SUCCESS.txt` already exists when it starts, do nothing.
3. Run it under PM2 (`ecosystem.config.js`, then `pm2 save`) so it restarts when the PC boots.
4. Test it now and show me the first log result.
