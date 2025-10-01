// app/api/models/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function GET(req) {
  const sql = getSql();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const days = Number(searchParams.get("days") || 60);

  const rows = q
    ? await sql`
        SELECT model, COUNT(*) AS n
        FROM listing_snapshots
        WHERE snapshot_ts >= now() - make_interval(days => ${days})
          AND model ILIKE ${"%" + q + "%"}
        GROUP BY model
        ORDER BY n DESC
        LIMIT 100;
      `
    : await sql`
        SELECT model, COUNT(*) AS n
        FROM listing_snapshots
        WHERE snapshot_ts >= now() - make_interval(days => ${days})
        GROUP BY model
        ORDER BY n DESC
        LIMIT 100;
      `;

  return NextResponse.json({ ok: true, rows });
}
