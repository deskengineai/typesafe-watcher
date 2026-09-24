# typesafe-watcher

Signups at [TypeSafe AI](https://typesafe.ai/) are closed ("Whoops, we're full"). This script tries to sign up with Google once an hour, in a background Chrome window, and stops once it gets in.

## Requirements

- Windows, Node.js 18+, [PM2](https://pm2.keymetrics.io/)
- The `bsk` CLI and the browser-skill Chrome extension, connected (`bsk browsers` lists your browser)
- Chrome already signed in to the Google account you want to use

## Setup

```sh
cp .env.example .env        # then set GOOGLE_EMAIL
npm run pm2                 # starts it under PM2 and saves the process list
pm2 logs typesafe-watcher
```

To start it when the PC boots, install [pm2-windows-startup](https://www.npmjs.com/package/pm2-windows-startup) once (`pm2-startup install`).

## What each check does

1. Opens `https://console.typesafe.ai/login` and clicks **Continue with Google**.
2. Picks the `GOOGLE_EMAIL` account in Google's account chooser.
3. Result:
   - `full`: the page shows `?error=signups_disabled` or "we're full". It tries again in 60 minutes.
   - `success`: the page lands inside the console. It writes `SUCCESS.txt`, shows a popup and stops checking.
   - `error` / `unknown`: logged. It tries again in 60 minutes.

Delete `SUCCESS.txt` to start checking again.

## Rebuild with Claude Code

See [PROMPT.md](PROMPT.md).
