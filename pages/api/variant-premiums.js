// pages/api/variant-premiums.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

const WINDOWS = [180, 90, 60];

function centsToDollars(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
}
function isPos(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}

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
}

export default async function handler(req, res) {
  try {
    const sql = getSql();

    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });

    const requestedKey = normalizeModelKey(raw);
    const degraded = degradeKeyForKnownBugs(requestedKey);
    const candidates = Array.from(new Set([requestedKey, degraded].filter(Boolean)));

    let selectedKey = null;
    let baseline = null;
    let windowDays = null;

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

    if (!baseline || !selectedKey) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: null },
        resolved: null,
        variants: [],
        variantsCount: 0
      });
    }

    const baseMedian = centsToDollars(baseline.p50_cents);
    windowDays = Number(windowDays || baseline.window_days || 0);
    if (!isPos(baseMedian)) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: null },
        resolved: { modelKey: selectedKey, windowDays },
        variants: [],
        variantsCount: 0
      });
    }

    // Pull variant-level ANY medians in the same window
    const rows = await sql`
      SELECT variant_key, n, p50_cents
      FROM aggregated_stats_variant
      WHERE model = ${selectedKey}
        AND COALESCE(variant_key,'') <> ''
        AND condition_band = 'ANY'
        AND window_days = ${windowDays}
    `;

    const variants = (rows || [])
      .map((r) => {
        const median = centsToDollars(r.p50_cents);
        if (!isPos(median)) return null;
        const premiumAbs = median - baseMedian;
        const premiumPct = baseMedian > 0 ? premiumAbs / baseMedian : 0;
        const tags = tagsFromVariantKey(selectedKey, r.variant_key);
        return {
          variantKey: r.variant_key,
          label: tags.length ? tags.join(' + ') : 'Variant',
          median,
          premiumAbs,
          premiumPct,
          pct_vs_any: (premiumPct * 100).toFixed(1),
          sampleSize: Number(r.n || 0),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.premiumPct - a.premiumPct);

    return res.status(200).json({
      ok: true,
      requested: { modelKey: requestedKey, window: null },
      resolved: { modelKey: selectedKey, windowDays },
      variants,
      variantsCount: variants.length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
