// app/api/admin/db-info/route.js
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getSql } from "../../../../lib/db";
export async function GET() {
  const sql = getSql();
  const [{ current_database }] = await sql`SELECT current_database()`;
  return NextResponse.json({ ok: true, current_database });
}
