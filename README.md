# DM Card Collector

DM Card Collector is a standalone, installable mobile PWA for collecting publicly visible Duel Masters card metadata **without connecting to Firebase, Firestore, or a production card database**. Records stay in the browser's IndexedDB until the user exports JSON.

## Features

- Capture pasted text/URLs, shared text/URLs (Web Share Target), bookmarklet payloads, or the visible DOM.
- Detect Duel Masters official pages, `dmwiki.net`, TCG PORTAL, picodoromeda, and unknown sites.
- Store compact raw evidence and image URL candidates (never image bodies or full-page archives).
- Validate into staging, isolate failures, detect duplicates and cross-source conflicts, and suggest canonical records.
- Resume-safe IndexedDB queues and chunked JSON export for large collections.
- Offline shell via Service Worker and GitHub Pages deployment workflow.

## Local development

```bash
python3 -m http.server 4173
# open http://localhost:4173
npm test
```

The app is dependency-free. IndexedDB data is local to the browser. Use **Export JSON** to back it up.

## Bookmarklet

Create a bookmark whose URL is the following, replacing `YOUR_PAGES_URL` after deployment:

```text
javascript:(()=>location.href='YOUR_PAGES_URL/?capture='+encodeURIComponent(JSON.stringify({url:location.href,title:document.title,text:(document.body.innerText||'').slice(0,50000),images:[...document.images].map(i=>i.currentSrc||i.src).filter(Boolean).slice(0,100)})))()
```

## GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys this static app after a push to `main`, or by manual dispatch. In repository **Settings → Pages**, select **GitHub Actions** as the source if it is not already selected.

## Privacy and safety

No analytics, authentication, remote API, Firebase SDK, or Firestore SDK is included. The collector never writes to source sites. Ordinary captures store capped text excerpts and URL strings only. MHT/MHTML files are retained only when the user explicitly imports them, in a separate local IndexedDB store for reproducible re-parsing.

## Offline MHT/MHTML import

Use **MHT/MHTMLを追加** to import a card-search or card-detail archive saved manually from the official site. The browser parses MIME parts locally, computes SHA-256 identities, stores the original archive in the additive `mhtRaw` IndexedDB store, and writes only human-review-required candidates to `mhtImports`. Imported scripts, frames, and remote resources are never executed or fetched. Archives are capped at 50 MB; failures remain retryable records. Bulk crawling and automatic approval are deliberately out of scope.

The in-browser parser and the Python image extractor serve different purposes: `src/mht.js` powers local PWA imports, while `tools/mht_extract.py` copies original embedded image bytes to an explicitly selected local output directory.
