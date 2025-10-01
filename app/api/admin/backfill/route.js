// app/api/admin/backfill/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { normalizeModelKey } from "../../../../lib/normalize";

const ADMIN_KEY = process.env.ADMIN_KEY || ""; // set in Vercel > Env

export async function POST(req) {
  // simple guard so randos can't run it
  if (ADMIN_KEY) {
    const key = req.headers.get("x-admin-key") || "";
    if (key !== ADMIN_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const sql = getSql();
  const rows = await sql`SELECT DISTINCT model FROM listing_snapshots`;
  let changed = 0;

  for (const { model } of rows) {
    const oldKey = model || "";
    const newKey = normalizeModelKey(oldKey);
    if (newKey && newKey !== oldKey) {
      await sql`UPDATE listing_snapshots SET model = ${newKey} WHERE model = ${oldKey}`;
      await sql`UPDATE listing_lifecycle SET model = ${newKey} WHERE model = ${oldKey}`;
      changed++;
    }
  }

  return NextResponse.json({ ok: true, totalDistinct: rows.length, changed });
}
