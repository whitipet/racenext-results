# RaceNext Results

A simple web client for browsing public RaceNext race results: pick an
event, pick a distance, see the full participant list with sortable
columns, filters, splits and CSV export.

The site is a single static page. Data is fetched live from RaceNext on
every visit; nothing is stored on the page or in the repository.

## Use it online

If the site has been deployed to GitHub Pages, just open the URL in any
modern browser. No installation, no account.

## Use it on your computer

Easiest path: **just open `index.html`** in any browser.

1. Download this folder. The simplest way: green **"Code"** button on
   the GitHub page → **Download ZIP** → unpack it.
2. Double-click `index.html` (or drag it into a browser window).

That's it. The page works straight off the disk. Data is fetched live
through public CORS proxies (`allorigins.win`, `codetabs.com`,
`thingproxy.freeboard.io` — no keys, no setup).

### When `index.html` is not enough — run the local server

The public CORS proxies are free services that occasionally rate-limit
or go down. If you open `index.html` and see "Не вдалося завантажити
список івентів" or similar errors, the bundled local server is a
guaranteed fallback. It does two things:

- serves the page over HTTP (some browsers restrict things like
  `<dialog>` modals on `file://`);
- proxies `/api/*` to RaceNext directly, so no public proxy is involved
  at all and the data is always fresh.

You'll need Python 3 (already installed on macOS and most Linux; on
Windows install it from <https://python.org>).

1. Open a terminal in this folder.
2. Run:

   ```sh
   python3 server.py
   ```

3. The site opens in your browser at <http://localhost:8000/>. Press
   `Ctrl+C` in the terminal to stop the server.

No build step, no `npm install`, no configuration.

## Things you can do

- **Switch language** (UK / EN) using the toggle in the top-right corner.
- **Search and filter** participants by name, bib number, gender or
  category.
- **Click a row** to expand it: see all checkpoint splits as a small
  visual track and the raw API record as JSON.
- **Export** the current view to a CSV file (compatible with Excel and
  Google Sheets).

## Install as an app

When you open the deployed site (or the local server) in a modern browser,
you can add it to your device's home screen / dock just like a real app:

- **Chrome / Edge (desktop & Android)**: there's an "Install" button in the
  address bar, or via the browser menu → "Install app".
- **iOS Safari**: Share button → "Add to Home Screen".

Once installed, the site opens in its own standalone window without
browser chrome, lands in your app drawer (Android) or dock (macOS) like
a native app, and keeps working when the network is flaky (the
interface still loads from cache; live race data simply waits for the
next time you're online).

## Settings

Click the gear icon in the top-right to:

- Provide a custom CORS proxy URL (only relevant in some self-hosting
  setups; the site picks sensible defaults automatically).
- Paste a Bearer token (only needed to access private endpoints).

## Disclaimer

All rights to the RaceNext brand and event data belong to their
respective owners. This is an unofficial client created solely for
more convenient viewing of public race results.
