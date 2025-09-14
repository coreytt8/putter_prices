// app/api/_diag-ebay/route.js
import { NextResponse } from "next/server";

export const runtime = "nodejs"; // force Node (not Edge)

export async function GET() {
  const hasId = !!process.env.EBAY_CLIENT_ID;
  const hasSecret = !!process.env.EBAY_CLIENT_SECRET;
  const site = process.env.EBAY_SITE || "EBAY_US";

  try {
    const id = process.env.EBAY_CLIENT_ID;
    const secret = process.env.EBAY_CLIENT_SECRET;
    if (!id || !secret) {
      return NextResponse.json(
        { ok: false, step: "env", hasId, hasSecret, site, hint: "Set EBAY_CLIENT_ID/EBAY_CLIENT_SECRET" },
        { status: 500 }
      );
    }

    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ ok: false, step: "oauth", status: res.status, body: text }, { status: 500 });
    }
    const { access_token } = JSON.parse(text);

    const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    u.searchParams.set("q", "scotty cameron");
    u.searchParams.set("limit", "1");
    u.searchParams.set("fieldgroups", "EXTENDED");

    const br = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": site,
        "X-EBAY-C-ENDUSERCTX": `contextualLocation=${site}`,
      },
      cache: "no-store",
    });

    const btxt = await br.text();
    return NextResponse.json(
      {
        ok: br.ok,
        oauth_ok: true,
        oauth_snippet: access_token ? "got_token" : "missing",
        browse_status: br.status,
        browse_body_snippet: btxt.slice(0, 600),
      },
      { status: br.ok ? 200 : 500 }
    );
  } catch (e) {
    return NextResponse.json({ ok: false, step: "exception", error: String(e) }, { status: 500 });
  }
}
