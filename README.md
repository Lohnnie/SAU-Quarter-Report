# SAU-Quarter-Report

Austin office market dashboard — submarket vacancy, absorption, rent, and development pipeline, plus a live regional economic indicators panel pulled from BLS and Census APIs.

Single static HTML file, no build step. Data comes from two places:

- **Office market data** — embedded from an uploaded Excel workbook, replaceable at runtime via the in-page "Upload Data" control.
- **Regional economic data** — fetched live, in the visitor's browser, from this repo's own Netlify serverless functions.

## Structure

```
.
├── index.html                    # the dashboard — static, no build step
├── netlify.toml                  # tells Netlify where the functions live
└── netlify/
    └── functions/
        ├── bls.js                # calls the BLS Public Data API server-side
        └── census.js             # calls the Census ACS API server-side
```

## How the two data sources work

**Office market data (Matrix / DIM / Micro Markets / Absorption / Rates)**
Loaded from a workbook at page-build time. To update it without touching code, open the dashboard, use **Upload Data (.xlsx)** in the toolbar, and select a workbook with the same five sheet names (`Matrix`, `DIM`, `Micro Markets`, `Absorption`, `Rates`). All tables and charts re-render from the new file immediately — nothing is sent to a server, the parsing happens in the browser.

**Regional economic data (BLS + Census)**
`index.html` calls `/.netlify/functions/bls` and `/.netlify/functions/census` on page load — relative paths, no keys, no logic beyond the fetch itself. Those two functions run server-side on Netlify, pull `BLS_API_KEY` and `CENSUS_API_KEY` from Netlify's environment (never from a file), call the real BLS/Census APIs, and return JSON. This only works when `index.html` is deployed on the **same Netlify site** as the functions — that's why they live in one repo.

If the functions aren't reachable (wrong deploy, missing keys, local file preview), the dashboard shows `—` placeholders and a plain status line. It never falls back to fabricated numbers.

## Deploy

1. Push this repo to Netlify (or connect it as a Netlify site from GitHub).
2. In **Site settings → Environment variables**, add:
   - `BLS_API_KEY` — your BLS Public Data API registration key
   - `CENSUS_API_KEY` — your Census Data API key
3. Trigger a deploy.
4. Open the deployed site. The Regional Economic Indicators section at the bottom should populate within a couple seconds; if it doesn't, check the Netlify function logs first.

## API contracts (for reference)

- `/.netlify/functions/bls?market1=<key>&market2=<key>`
- `/.netlify/functions/census?market1=<key>&market2=<key>`

Valid market keys: `austin`, `dallas`, `houston`, `sanAntonio`. Each call accepts exactly two markets, so `index.html` makes two paired calls per source (`austin`+`dallas`, `houston`+`sanAntonio`) and merges the results client-side to cover all four metros.

## Local preview

Opening `index.html` directly as a local file will render the office market dashboard fully, but the BLS/Census section will stay empty — serverless functions only run once deployed to Netlify (or run locally via `netlify dev`, if you have the Netlify CLI installed).
