// app/api/putters/route.js
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json([
    { id: 1, name: "Odyssey White Hot", price: 199.99, source: "eBay" },
    { id: 2, name: "Scotty Cameron Newport", price: 349.99, source: "Golf Galaxy" },
    { id: 3, name: "Ping Anser", price: 149.99, source: "2nd Swing" },
  ]);
}
