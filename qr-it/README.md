# QR-IT

Static QR codes that never expire. No account, no watermark, no tracking, nothing uploaded.

QR-IT is a single web page. Everything runs in your browser: the codes are generated
on your device, test-scanned on your device, and nothing is ever sent anywhere.
The page's Content-Security-Policy blocks all outside network requests, so you don't
have to take that on trust: open DevTools and check.

## Features

- Links and text, Wi‑Fi (WPA/WEP/open, hidden networks), contacts (vCard) and email
- Every code is **test-scanned as you edit**, including your logo and caption
- Colours with contrast warnings, error correction L/M/Q/H, quiet zone, export up to 4096 px
- Optional centre logo (switches to error correction H automatically)
- Optional caption under the code
- PNG and SVG download, copy image, copy SVG
- **Printable Wi‑Fi card** (A6, 300 dpi) with network name and password
- **Batch mode**: paste a list or load a CSV, get a ZIP of codes named by label,
  plus an `index.csv`. Codes that fail the scan check are left out and flagged.
- Remembers your look settings on your device (never the content you type)
- Works offline and can be installed as an app once loaded

## Why static codes

A static QR code stores the data in the pattern itself. Many "free" generators make
*dynamic* codes that point at their own redirect server, then switch that server off
when a trial ends. A static code has no server to switch off.

## Project layout

```
public/          the deployable site (this is what gets hosted)
  index.html     the whole app, built by build.py
  sw.js          offline cache, built by build.py
  manifest.webmanifest, icons, _headers
src/
  app.html       markup and styles
  app.js         app logic
  sw.js          offline cache template
vendor/          minified third-party libraries (see THIRD-PARTY-NOTICES.md)
build.py         combines src + vendor into public/
```

## Making changes

Edit `src/app.html` or `src/app.js`, then run:

```
python3 build.py
```

No dependencies beyond Python 3. Open `public/index.html` directly to test, or run
`python3 -m http.server -d public 8000` and visit http://localhost:8000 to test
offline mode too. Commit the rebuilt `public/` folder.

## Deploying (Cloudflare Pages, free)

1. Push this repo to GitHub.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages →
   Connect to Git** and pick the repo.
3. Build settings: Framework preset **None**, build command **empty**,
   build output directory **`public`**.
4. Deploy. You get `https://<project-name>.pages.dev`; add your own domain under
   **Custom domains** whenever you like.

Every push to `main` redeploys automatically.

GitHub Pages also works (serve the `public/` folder via a GitHub Actions Pages
workflow), but it ignores `_headers`, so you lose the extra security headers.
The in-page Content-Security-Policy still applies.

## Licence

MIT, see `LICENSE`. Bundled libraries keep their own licences, listed in
`THIRD-PARTY-NOTICES.md`.
