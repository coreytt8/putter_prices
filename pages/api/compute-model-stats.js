// pages/api/compute-model-stats.js
import { db } from "../../lib/db";

// Protect this route with a shared secret in env
// Set CRON_SECRET in Vercel (and locally if you want to hit it by hand)
const SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  if (!SECRET) {
    return res.status(500).json({ ok: false, error: "CRON_SECRET not set" });
  }
  const hdr = req.headers["x-cron-secret"];
  if (hdr !== SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  // Window for stats (last 30 days is a good default)
  const days = Number(req.query.days || "30");
  const bucketDate = req.query.date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  try {
    // Aggregate and upsert for today’s bucket_date
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
        set n          = excluded.n,
            price_min  = excluded.price_min,
            price_p25  = excluded.price_p25,
            price_median = excluded.price_median,
            price_p75  = excluded.price_p75,
            price_max  = excluded.price_max,
            computed_at = now();
      `,
      [bucketDate, days]
    );

    return res.status(200).json({ ok: true, upserted: rowCount, bucket_date: bucketDate, window_days: days });
  } catch (e) {
    console.error("compute-model-stats error:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
