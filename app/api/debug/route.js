// app/api/debug/route.js
import { NextResponse } from "next/server";

export async function GET() {
  const val = process.env.EBAY_APP_ID || "";
  return NextResponse.json({
    hasEBAY_APP_ID: Boolean(val),
    EBAY_APP_ID_length: val.length, // shows length only (no secret leak)
    runtime: process.env.NEXT_RUNTIME || "node",
  });
}
