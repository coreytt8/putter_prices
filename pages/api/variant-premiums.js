// pages/api/variant-premiums.js
export const runtime = 'nodejs';

import { getSql } from '../../lib/db';
import { normalizeModelKey, degradeKeyForKnownBugs } from '../../lib/normalize';

function centsToDollars(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : null;
}
function isPos(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0;
}
function parseWindow(req) {
  const raw = String(req.query.window || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return [60, 90, 180].includes(n) ? n : null;
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

async function selectBaselineAny(sql, modelKey, prefWindow = null) {
  if (prefWindow) {
    const rows = await sql`
      SELECT window_days, p50_cents
      FROM aggregated_stats_variant
      WHERE model = ${modelKey}
        AND COALESCE(variant_key,'') = ''
        AND condition_band = 'ANY'
        AND window_days = ${prefWindow}
      LIMIT 1
    `;
    if (rows?.length) return rows[0];
  }
  const rows2 = await sql`
    SELECT window_days, p50_cents
    FROM aggregated_stats_variant
    WHERE model = ${modelKey}
      AND COALESCE(variant_key,'') = ''
      AND condition_band = 'ANY'
    ORDER BY window_days DESC
    LIMIT 1
  `;
  return rows2?.[0] || null;
}

export default async function handler(req, res) {
  try {
    const sql = getSql();

    const raw = String(req.query.model || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Missing model' });

    const requestedKey = normalizeModelKey(raw);
    const degraded = degradeKeyForKnownBugs(requestedKey);
    const prefWindow = parseWindow(req);

    const candidates = [requestedKey];
    if (degraded && degraded !== requestedKey) candidates.push(degraded);

    let selectedKey = requestedKey;
    let baseline = null;

    for (const key of candidates) {
      const row = await selectBaselineAny(sql, key, prefWindow);
      if (row) { selectedKey = key; baseline = row; break; }
    }

    if (!baseline) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: prefWindow },
        resolved: null,
        variants: [],
        variantsCount: 0
      });
    }

    const baseMedian = centsToDollars(baseline.p50_cents);
    const windowDays = Number(baseline.window_days || 0);
    if (!isPos(baseMedian)) {
      return res.status(200).json({
        ok: true,
        requested: { modelKey: requestedKey, window: prefWindow },
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
      // some minimum support so we don’t show 1-off variants:
      .filter(v => v.sampleSize >= 2)
      .sort((a, b) => b.premiumPct - a.premiumPct)
      .slice(0, 8);

    return res.status(200).json({
      ok: true,
      requested: { modelKey: requestedKey, window: prefWindow },
      resolved: { modelKey: selectedKey, windowDays },
      variants,
      variantsCount: variants.length
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
