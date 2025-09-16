// pages/api/model-stats.js
export const runtime = "nodejs";
import { db } from "../../lib/db";

// Keep key normalization aligned with your grouping
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
    const windowDays = Number(days || "90");

    const modelKey = model?.trim()
      ? String(model).trim().toLowerCase()
      : q?.trim()
        ? normalizeModelKey(String(q))
        : null;

    if (!modelKey) {
      // Optional: list current “latest snapshots” for a trending widget
      const { rows } = await db.query(`
        with latest as (
          select model_key, bucket_date, n, price_median,
                 row_number() over (partition by model_key order by bucket_date desc) rn
          from model_stats
        )
        select model_key, bucket_date, n, price_median
        from latest
        where rn = 1
        order by n desc, price_median asc
        limit 50
      `);
      return res.status(200).json({ ok: true, list: rows });
    }

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
  } catch (e) {
    console.error("model-stats error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
