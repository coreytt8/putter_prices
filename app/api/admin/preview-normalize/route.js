export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "../../../../lib/normalize";

const ADMIN_KEY = process.env.ADMIN_KEY || "";

export async function GET(req) {
  if (ADMIN_KEY) {
    const key = req.headers.get("x-admin-key") || "";
    if (key !== ADMIN_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  const sql = getSql();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(200, Number(searchParams.get("limit") || 100));

  const rows = q
    ? await sql`
        SELECT model, COUNT(*)::int AS n
        FROM listing_snapshots
        WHERE model ILIKE ${'%' + q + '%'}
        GROUP BY model
        ORDER BY n DESC
        LIMIT ${limit};
      `
    : await sql`
        SELECT model, COUNT(*)::int AS n
        FROM listing_snapshots
        GROUP BY model
        ORDER BY n DESC
        LIMIT ${limit};
      `;

  const preview = rows.map(r => ({
    from: r.model,
    to: normalizeModelKey(r.model || ""),
    n: r.n
  }));
  return NextResponse.json({ ok: true, preview });
}
