// app/methodology/page.js
export const metadata = {
  title: "Methodology · PutterIQ",
  description: "How PutterIQ determines fair price badges and deal scores.",
};

export default function MethodologyPage() {
  const Row = ({ label, children }) => (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 md:col-span-3 text-sm font-semibold text-slate-800">{label}</div>
      <div className="col-span-12 md:col-span-9 text-sm text-slate-700">{children}</div>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">How We Calculate Fair Prices</h1>
      <p className="mt-3 text-slate-600">
        PutterIQ estimates a live market baseline for each model (and condition band) using percentile distributions built
        from recent eBay listing history. We highlight listings that are below, near, or above that live baseline with a
        color-coded badge and an optional deal score.
      </p>

      <section className="mt-8 space-y-5">
        <Row label="Data window">
          We analyze a rolling 60–90 day window of live listing history (including active and recently ended inventory) and
          refresh throughout the day. Stale snapshots are removed quickly so baselines reflect the current market.
        </Row>

        <Row label="Condition bands">
          Baselines are computed separately for: <strong>New</strong>, <strong>Like‑New</strong>, <strong>Good</strong>, <strong>Fair</strong>.
          When a band lacks data, we fall back to the overall model median and lower the confidence signal.
        </Row>

        <Row label="Cleaning & outliers">
          We remove invalid asks, duplicate listings, and trim the tails (e.g., top/bottom 5%) to reduce the impact of
          outliers and rare bundles.
        </Row>

        <Row label="Expected price">
          The primary estimator is the <strong>median</strong> (p50) of live listing totals after cleaning and trimming.
        </Row>

        <Row label="Dispersion & confidence">
          We compute dispersion (e.g., IQR/median) and sample size <code>n</code>. Confidence increases with more qualifying listings
          and tighter spreads in the live ask distribution.
        </Row>

        <Row label="Badge tiers">
          <ul className="list-disc pl-5">
            <li><strong>Great Deal</strong>: ≤ −20% vs expected</li>
            <li><strong>Good Price</strong>: −20% to −10%</li>
            <li><strong>Fair</strong>: −10% to +10%</li>
            <li><strong>Above Market</strong>: +10% to +25%</li>
            <li><strong>Overpriced</strong>: &gt; +25%</li>
            <li><strong>Not enough data</strong>: low sample size or high variance</li>
          </ul>
        </Row>

        <Row label="Deal score (0–100)">
          Combines savings (how far below expected) with confidence. High confidence + bigger savings yields a higher score.
        </Row>

        <Row label="Limitations">
          Unique specs and condition details can make two listings non‑identical. Always review photos and seller info.
        </Row>

        <Row label="Questions?">
          Reach us at <a className="text-blue-600 underline" href="mailto:hello@putteriq.com">hello@putteriq.com</a>.
        </Row>
      </section>
    </main>
  );
}
