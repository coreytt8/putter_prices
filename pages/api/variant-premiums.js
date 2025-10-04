// pages/api/variant-premiums.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

<<<<<<< HEAD
// --- helpers ---
=======
const WINDOWS = [180, 90, 60];

>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
function centsToDollars(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
}
function isPos(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}

<<<<<<< HEAD
async function selectBaselineAny(sql, modelKey, prefWindow = null) {
  // try preferred window
  if (prefWindow) {
    const r = await sql`
      SELECT window_days, p50_cents
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND COALESCE(variant_key,'') = ''
        AND condition_band = 'ANY'
        AND window_days = ${prefWindow}
      LIMIT 1
    `;
    if (r?.length) return r[0];
  }
  // else take most recent window available
  const r2 = await sql`
    SELECT window_days, p50_cents
    FROM aggregated_stats_variant
    WHERE model = ${modelKey}
      AND COALESCE(variant_key,'') = ''
      AND condition_band = 'ANY'
    ORDER BY window_days DESC
    LIMIT 1
  `;
  return r2?.[0] || null;
}

const TAG_LABELS = new Map([
  ['button_back', 'Button Back'],
  ['circle_t', 'Circle T'],
  ['tour_only', 'Tour Only'],
  ['gss', 'GSS'],
  ['limited', 'Limited'],
  ['prototype', 'Prototype'],
  ['tei3', 'Teryllium T3'],
  ['009', '009'],
  ['garage', 'Custom Garage'],
  ['small_slant', 'Small Slant'],
]);

function formatTags(variantKey) {
  if (!variantKey) return { tags: [], label: '' };
  const parts = String(variantKey).split('|');
  // variant_key format is "model|tag|tag" -> drop the first element (model)
  const tags = parts.slice(1).filter(Boolean);
  const label = tags
    .map(t => TAG_LABELS.get(t) || t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' + ');
  return { tags, label };
=======
function prettyTag(tag) {
  const map = new Map([
    ['circle_t', 'Circle T'],
    ['tour_only', 'Tour Only'],
    ['gss', 'GSS'],
    ['button_back', 'Button Back'],
    ['tei3', 'TeI3'],
    ['garage', 'Garage'],
    ['limited', 'Limited'],
    ['prototype', 'Prototype'],
    ['small_slant', 'Small Slant'],
  ]);
  if (map.has(tag)) return map.get(tag);
  // Title-case fallback
  return tag
    .split(/[_-]+/g)
    .map((s) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s)
    .join(' ');
}

function tagsFromVariantKey(model, variantKey) {
  // variant_key is usually "model|tag|tag"
  const parts = String(variantKey || '').split('|');
  if (parts.length <= 1) return [];
  const [, ...rawTags] = parts;
  return rawTags.map(prettyTag);
>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
}

export default async function handler(req, res) {
  try {
    const sql = getSql();

    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });

    const prefWindow = parseWindow(req); // 60|90|180|null

    // Build candidate keys
    const requestedKey = normalizeModelKey(raw);
    const degraded = degradeKeyForKnownBugs(requestedKey);
<<<<<<< HEAD
    const candidates = [requestedKey];
    if (degraded && degraded !== requestedKey) candidates.push(degraded);

    // 1) Find a baseline ANY median for the parent model
    let selectedKey = requestedKey;
    let baseline = null;
=======
    const candidates = Array.from(new Set([requestedKey, degraded].filter(Boolean)));

    let selectedKey = null;
    let baseline = null;
    let windowDays = null;

>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
    for (const key of candidates) {
      for (const w of WINDOWS) {
        const rows = await sql`
          SELECT window_days, p50_cents
          FROM aggregated_stats_variant
          WHERE model = ${key}
            AND COALESCE(variant_key,'') = ''
            AND condition_band = 'ANY'
            AND window_days = ${w}
          LIMIT 1
        `;
        const row = rows?.[0];
        if (row && row.p50_cents != null) {
          selectedKey = key;
          baseline = row;
          windowDays = Number(row.window_days);
          break;
        }
      }
      if (baseline) break;
    }
<<<<<<< HEAD
    if (!baseline) {
      // no direct parent baseline; return soft failure
=======

    if (!baseline || !selectedKey) {
>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: null },
        resolved: null,
        variantsCount: 0,
        variants: [],
      });
    }

<<<<<<< HEAD
    const baselineMedian = centsToDollars(baseline.p50_cents);
    const windowDays = Number(baseline.window_days ?? 0);
    if (!isPos(baselineMedian)) {
=======
    const baseMedian = centsToDollars(baseline.p50_cents);
    windowDays = Number(windowDays || baseline.window_days || 0);
    if (!isPos(baseMedian)) {
>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: null },
        resolved: { modelKey: selectedKey, windowDays },
        variantsCount: 0,
        variants: [],
      });
    }

    // 2) Pull variant rows (ANY band) from the "family":
    //    exact parent OR children that start with the parent key
    const like = `${selectedKey}%`;
    const rows = await sql`
      SELECT model, variant_key, n, p50_cents
      FROM aggregated_stats_variant
      WHERE window_days = ${windowDays}
        AND condition_band = 'ANY'
        AND COALESCE(variant_key,'') <> ''
        AND (model = ${selectedKey} OR model LIKE ${like})
      ORDER BY n DESC NULLS LAST, p50_cents DESC NULLS LAST
      LIMIT 100
    `;

    if (!rows?.length) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: prefWindow },
        resolved: { modelKey: selectedKey, windowDays },
        variantsCount: 0,
        variants: [],
      });
    }

    // 3) Build premiums vs the parent's ANY median
    const variants = rows
      .map(r => {
        const median = centsToDollars(r.p50_cents);
        if (!isPos(median)) return null;
        const premiumAbs = median - baselineMedian;
        const premiumPct = baselineMedian > 0 ? premiumAbs / baselineMedian : 0;
        const { tags, label } = formatTags(r.variant_key);
        return {
          model: r.model,                  // the child model label
          variantKey: r.variant_key,       // "model|tag|tag"
          tags,                            // ["button_back","gss",...]
          label,                           // "Button Back + GSS"
          median,                          // variant ANY median ($)
          premiumAbs,                      // $ over parent ANY
          premiumPct,                      // fraction over parent ANY
          pct_vs_any: (premiumPct * 100).toFixed(1),
          sampleSize: Number(r.n || 0),
          lowSample: Number(r.n || 0) < 3, // flag for UI
        };
      })
      .filter(Boolean)
<<<<<<< HEAD
      // drop variants that have zero price (shouldn't happen) or identical median to baseline
      .filter(v => v.median != null && Number.isFinite(v.premiumPct))
      // most interesting first
=======
>>>>>>> 2ebd5602262cd7e656d23bebf44cdfabd8988385
      .sort((a, b) => b.premiumPct - a.premiumPct);

    return res.status(200).json({
      ok: true,
      requested: { modelKey: requestedKey, window: null },
      resolved: { modelKey: selectedKey, windowDays },
      variantsCount: variants.length,
      variants,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
