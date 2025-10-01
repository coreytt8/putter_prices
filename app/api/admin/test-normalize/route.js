export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { normalizeModelKey } from "../../../../lib/normalize";

const ADMIN_KEY = process.env.ADMIN_KEY || "";

export async function GET(req) {
  if (ADMIN_KEY) {
    const k = req.headers.get("x-admin-key") || "";
    if (k !== ADMIN_KEY) return NextResponse.json({ ok:false, error:"unauthorized" }, { status:401 });
  }
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") || "";
  return NextResponse.json({ ok:true, from:title, to: normalizeModelKey(title) });
}
