## Overview

This project tracks secondary-market pricing for popular putter models by polling the eBay Browse API on a schedule and surfacing the results in a Next.js dashboard.

## Shared putter catalog

Seed searches, UI filters, and future normalization work pull from a single list of brand/model pairs in `lib/data/putterCatalog.js`. Each entry in `PUTTER_CATALOG` is a `{ brand, model }` object, kept alphabetical by brand to minimize merge conflicts.

To add or edit models:

1. Update `lib/data/putterCatalog.js` with the new `{ brand, model }` rows.
2. Keep brands grouped alphabetically and prefer the naming conventions used by the OEM so the queries match how listings are titled.
3. If the models also appear in other systems (CMS, Google Sheet, etc.), this file can import that configuration instead. Export the array from your integration so `PUTTER_CATALOG` remains the single source of truth and the API route continues to work without code changes.

The file also exports `PUTTER_SEED_QUERIES`, which is automatically derived from the catalog and used by the cron job.

You can count the entries at any time with:

```bash
node -e "import('./lib/data/putterCatalog.js').then(m => console.log(m.PUTTER_CATALOG.length))"
```

## Cron query generation and eBay API limits

`pages/api/cron/collect-prices.js` builds its `SEED_QUERIES` array directly from `PUTTER_SEED_QUERIES`, so every brand/model pair in the catalog results in a search query shaped like `${brand} ${model} putter`.

The cron currently fetches two pages (100 items max) per query, so each catalog entry results in at most two Browse API requests. With the current catalog of 110 putters, that is 220 calls per execution, comfortably below eBay's default 5,000-call daily cap for the Browse API. When adding a large number of models, re-run the count command above and ensure `catalogSize * 2` stays below your account's allocation (visible in the [eBay developer portal](https://developer.ebay.com/api-docs/buy/static/overview.html)).

## Local development

Run the development server with:

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000). The page auto-updates as you edit source files.
