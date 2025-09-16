// pages/api/compute-model-stats.js

// Ensure this runs on the Node.js runtime (not Edge) so `pg` works
export const runtime = "nodejs";

import { db } from "../../lib/db";

// Optional shared secret for manual (non-cron) runs.
// Set CRON_SECRET in Vercel → Settings → Environment Variables.
const SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // Vercel Cron adds this header automatically
  const isVercelCron = req.headers["x-vercel-cron"] === "1";

  // Allow manual runs with a secret (either query ?secret=... or header x-cron-secret)
  const providedSecret = req.query.secret || req.headers["x-cron-secret"];

  if (!isVercelCron) {
    if (!SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized (CRON_SECRET not set)" });
    }
    if (providedSecret !== SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized (bad secret)" });
    }
  }

  // Parameters:
  // - days: rolling window (default 30)
  // - date: bucket date (YYYY-MM-DD). Defaults to today's UTC date.
  const days = Number(req.query.days || "30");
  const bucketDate =
    (typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      ? req.query.date
      : new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // Aggregate by model_key over the rolling window and upsert into model_stats
    const { rowCount } = await db.query(
      `
      insert into model_stats (
        model_key, bucket_date, n, price_min, price_p25, price_median, price_p75, price_max, computed_at
      )
      select
        model_key,
        $1::date as bucket_date,
        count(*) as n,
        min(price) as price_min,
        percentile_cont(0.25) within group (order by price) as price_p25,
        percentile_cont(0.5)  within group (order by price) as price_median,
        percentile_cont(0.75) within group (order by price) as price_p75,
        max(price) as price_max,
        now() as computed_at
      from listing_events
      where price is not null
        and seen_at >= now() - ($2 || ' days')::interval
      group by model_key
      on conflict (model_key, bucket_date) do update
        set n            = excluded.n,
            price_min    = excluded.price_min,
            price_p25    = excluded.price_p25,
            price_median = excluded.price_median,
            price_p75    = excluded.price_p75,
            price_max    = excluded.price_max,
            computed_at  = now();
      `,
      [bucketDate, days]
    );

    return res
      .status(200)
      .json({ ok: true, upserted: rowCount, bucket_date: bucketDate, window_days: days, cron: isVercelCron });
  } catch (e) {
    console.error("compute-model-stats error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
