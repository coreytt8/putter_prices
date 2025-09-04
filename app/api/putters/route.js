import { NextResponse } from "next/server";

export async function GET(req) {
  return NextResponse.json({
    routeVersion: "v3-unique-marker",
    ts: Date.now(),
  }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
