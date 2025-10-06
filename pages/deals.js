// pages/deals.js
import TopDealsGrid from "../components/TopDealsGrid";

export default function DealsPage({ deals = [], windowHours = 168 }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Top Deals</h1>
      <p className="mt-1 text-sm text-gray-600">
        Showing best current prices vs. recent medians (window: {windowHours}h).
      </p>
      <div className="mt-6">
        <TopDealsGrid deals={deals} />
      </div>
    </main>
  );
}

export async function getServerSideProps(ctx) {
  const win = Number(ctx.query.window || ctx.query.windowHours || 720) || 720; // start wide so it's never empty
  const host = ctx.req.headers.host || "localhost:3000";
  const proto = ctx.req.headers["x-forwarded-proto"] || (host.includes("localhost") ? "http" : "https");
  const base = `${proto}://${host}`;

  const res = await fetch(`${base}/api/top-deals?lookbackWindowHours=${win}`);
  const json = await res.json().catch(() => ({ ok: false, deals: [] }));

  return {
    props: {
      deals: json.deals || [],
      windowHours: json.meta?.lookbackWindowHours || win,
    },
  };
}
