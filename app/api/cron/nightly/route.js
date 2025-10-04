export const runtime = "nodejs";

import fs from "node:fs/promises";
import path from "node:path";

async function readLines(p) {
  const raw = await fs.readFile(path.resolve(p), "utf8");
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function json(res, init) {
  return Response.json(res, init);
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") || "";
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    let limit = Number(url.searchParams.get("limit") || 50);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    let pause = Number(url.searchParams.get("pause") || 1200);
    if (!Number.isFinite(pause) || pause < 0) pause = 0;
    const file = url.searchParams.get("file") || "data/seed-models.txt";

    const origin = url.origin;
    const adminKey = process.env.ADMIN_KEY;
    if (!adminKey) {
      return json({ ok: false, error: "missing ADMIN_KEY env" }, { status: 500 });
    }

    const models = await readLines(file);
    const seeded = [];
    for (const model of models) {
      const target = new URL(`${origin}/api/admin/fetch-browse`);
      target.searchParams.set("limit", String(limit));
      target.searchParams.set("model", model);

      const resp = await fetch(target.toString(), {
        method: "POST",
        headers: { "X-ADMIN-KEY": adminKey, "Content-Type": "application/json" },
        body: "",
      });

      let jsonBody = null;
      try {
        jsonBody = await resp.json();
      } catch (_) {
        // ignore non-JSON responses
      }
      seeded.push({
        model,
        ok: Boolean(jsonBody?.ok),
        saw: jsonBody?.saw || 0,
        inserted: jsonBody?.inserted || 0,
        status: resp.status,
      });

      if (pause > 0) {
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
    }

    const aggUrl = `${origin}/api/admin/aggregate?secret=${encodeURIComponent(
      process.env.CRON_SECRET
    )}`;
    const aggResp = await fetch(aggUrl);
    let aggregate = { status: aggResp.status };
    try {
      const aggJson = await aggResp.json();
      if (aggJson && typeof aggJson === "object") {
        aggregate = aggJson;
      }
    } catch (_) {
      // ignore non-JSON responses
    }

    return json({ ok: true, seeded, aggregate });
  } catch (e) {
    return json({ ok: false, error: e.message }, { status: 500 });
  }
}
