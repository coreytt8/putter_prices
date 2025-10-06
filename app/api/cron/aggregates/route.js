export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getSql } from "@/lib/db";

const CRON_SECRET = process.env.CRON_SECRET;

function splitSqlFile(sqlText) {
  // Remove single-line comments and collapse
  const withoutComments = sqlText
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  // Split on semicolons, trim, drop empties
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret") || "";
    if (!CRON_SECRET || secret !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sql = getSql();
    const filePath = path.join(process.cwd(), "db", "aggregates_60_90_180.sql");
    const fileText = (await readFile(filePath)).toString("utf8");
    const statements = splitSqlFile(fileText);

    let ran = 0;
    const errors = [];

    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
        ran++;
      } catch (e) {
        errors.push(String(e));
        // keep going; report all errors at the end
      }
    }

    return NextResponse.json({
      ok: errors.length === 0,
      ran,
      errors: errors.slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
