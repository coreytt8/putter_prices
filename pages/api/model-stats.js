// pages/api/model-stats.js
import { db } from "../../lib/db";

// Keep this tiny normalizer compatible with your group key logic
function normalizeModelKey(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/scotty\s*cameron|titleist|putter|golf|\b(rh|lh)\b|right\s*hand(ed)?|left\s*hand(ed)?/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { model, q, days } = req.query;
    const windowDays = Number(days || "90"); // how far back to return history if you chart

    // Case A: exact model key requested (preferred in UI)
    if (model && String(model).trim()) {
      const modelKey = String(model).trim().toLowerCase();

      const { rows } = await db.query(
        `
        select bucket_date, n, price_min, price_p25, price_median, price_p75, price_max
        from model_stats
        where model_key = $1
          and bucket_date >= current_date - $2::int
        order by bucket_date desc
        limit 180
        `,
        [modelKey, windowDays]
      );

      // latest snapshot for badges
      const latest = rows[0] || null;
      return res.status(200).json({ ok: true, model_key: modelKey, latest, series: rows });
    }

    // Case B: free-text query (normalize into your key)
    if (q && String(q).trim()) {
      const modelKey = normalizeModelKey(String(q));
      const { rows } = await db.query(
        `
        select bucket_date, n, price_min, price_p25, price_median, price_p75, price_max
        from model_stats
        where model_key = $1
          and bucket_date >= current_date - $2::int
        order by bucket_date desc
        limit 180
        `,
        [modelKey, windowDays]
      );
      const latest = rows[0] || null;
      return res.status(200).json({ ok: true, model_key: modelKey, latest, series: rows });
    }

    // Case C: no params → return top movers today (for a “trending” widget)
    const { rows } = await db.query(
      `
      with latest as (
        select model_key, bucket_date, n, price_median,
               row_number() over (partition by model_key order by bucket_date desc) as rn
        from model_stats
      )
      select model_key, bucket_date, n, price_median
      from latest
      where rn = 1
      order by n desc, price_median asc
      limit 50;
      `
    );
    return res.status(200).json({ ok: true, list: rows });
  } catch (e) {
    console.error("model-stats error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
