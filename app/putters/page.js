"use client";

import { useEffect, useMemo, useState } from "react";
import MarketSnapshot from "@/components/MarketSnapshot";
import PriceSparkline from "@/components/PriceSparkline";
import SmartPriceBadge from "@/components/SmartPriceBadge";


/* ============================
   SMART FAIR-PRICE BADGE (inline, JS/JSX)
   ============================ */

// Confidence from sample size + dispersion (IQR/median or approx)
function getConfidence(sampleSize = 0, dispersionRatio = 0.35) {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
  // simple shape: more samples ↑, less dispersion ↑ → confidence ↑
  const nTerm = Math.min(1, Math.log10(Math.max(1, sampleSize + 1)) / 2); // ~0→1 across 1..100+
  const d = Number.isFinite(dispersionRatio) ? Math.max(0, Math.min(1, dispersionRatio)) : 0.35;
  const dispTerm = 1 - d; // lower dispersion = higher confidence
  const c = (0.6 * nTerm) + (0.4 * dispTerm);
  return Math.max(0, Math.min(1, c));
}

// Build a tiny "fair price" helper (using p50 and an IQR-aware band)
function fairPriceBadge(price, stats) {
  if (!stats || typeof price !== "number" || !Number.isFinite(price)) return null;

  const p10 = Number(stats.p10);
  const p50 = Number(stats.p50);
  const p90 = Number(stats.p90);

  if (![p10, p50, p90].every(Number.isFinite)) return null;

  // dispersion approx as (p90-p10)/p50, clamp 0..1
  const dispersionRatio = Math.max(0, Math.min(1, (p90 - p10) / Math.max(1, p50)));
  const conf = getConfidence(Number(stats.count) || 0, dispersionRatio);

  // simple thresholds around median
  const deltaPct = Math.round(((p50 - price) / p50) * 100); // + means cheaper

  if (deltaPct >= 15) {
    return { label: `Great (−${Math.abs(deltaPct)}%)`, tone: "emerald", conf };
  } else if (deltaPct >= 5) {
    return { label: `Good (−${Math.abs(deltaPct)}%)`, tone: "green", conf };
  } else if (deltaPct <= -10) {
    return { label: `Overpriced (+${Math.abs(deltaPct)}%)`, tone: "orange", conf };
  }
  return { label: "Fair", tone: "green", conf };
}

/* ============================
   LIGHT HELPERS
   ============================ */

function formatPrice(value, currency = "USD") {
  if (typeof value !== "number" || !isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
function timeAgo(ts) {
  if (!ts) return "";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
function cx(...args) {
  return args.filter(Boolean).join(" ");
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function uniq(arr) {
  return Array.from(new Set(arr || []));
}

/* ============================
   MODEL / STATS KEYS
   ============================ */

function normalizeModel(s) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}
function getModelKey(o) {
  if (typeof o?.model === "string" && o.model.trim()) return o.model.trim();
  if (typeof o?.groupModel === "string" && o.groupModel.trim()) return o.groupModel.trim();
  if (typeof o?.title === "string" && o.title.trim()) {
    const t = o.title.replace(/\s+/g, " ").trim();
    const first = t.split(" - ")[0] || t;
    return first.slice(0, 120);
  }
  return "";
}
function getStatsKey(model, cond) {
  return `${model}::${cond || "ANY"}`;
}

function selectedConditionBand(conds) {
  return Array.isArray(conds) && conds.length === 1 ? conds[0] : "";
}

/* ============================
   DATA FETCHERS
   ============================ */

async function fetchModels({ q = "", minPrice = "", maxPrice = "", onlyComplete = true, conds = [], sort = "POPULAR", page = 1, perPage = 24 }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (minPrice) params.set("minPrice", String(minPrice));
  if (maxPrice) params.set("maxPrice", String(maxPrice));
  if (onlyComplete) params.set("onlyComplete", "1");
  for (const c of conds || []) params.append("cond", c);
  if (sort) params.set("sort", sort);
  if (page) params.set("page", String(page));
  if (perPage) params.set("perPage", String(perPage));

  const r = await fetch(`/api/putters?${params.toString()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to fetch models");
  return r.json();
}

async function fetchModelStatsBatch(keys = []) {
  const r = await fetch(`/api/model-stats`, {
    method: "POST",
    body: JSON.stringify({ keys }),
    headers: { "content-type": "application/json" },
  });
  if (!r.ok) throw new Error("Failed to fetch stats");
  return r.json();
}

async function fetchSeries(model, days = 90) {
  const r = await fetch(`/api/analytics/series?model=${encodeURIComponent(model)}&days=${days}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to fetch series");
  return r.json();
}

/* ============================
   PAGE
   ============================ */
export default function PuttersPage() {
  // filters/state
  const [onlyComplete, setOnlyComplete] = useState(true);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [conds, setConds] = useState([]);
  const [sort, setSort] = useState("POPULAR");
  const [q, setQ] = useState("");

  // paging
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24);

  // data
  const [groups, setGroups] = useState([]);
  const [flat, setFlat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ts, setTs] = useState(null);

  // analytics caches
  const [statsByModel, setStatsByModel] = useState({});
  const [seriesByModel, setSeriesByModel] = useState({});

  // ui
  const [mode, setMode] = useState("GROUP"); // "GROUP" | "FLAT"

  // load results
  useEffect(() => {
    let on = true;
    setLoading(true);
    fetchModels({ q, minPrice, maxPrice, onlyComplete, conds, sort, page, perPage })
      .then((json) => {
        if (!on) return;
        setGroups(Array.isArray(json.groups) ? json.groups : []);
        setFlat(Array.isArray(json.flat) ? json.flat : []);
        setTs(json.ts || Date.now());
      })
      .catch(() => {})
      .finally(() => on && setLoading(false));
    return () => { on = false; };
  }, [q, minPrice, maxPrice, onlyComplete, JSON.stringify(conds), sort, page, perPage]);

  // GROUP VIEW: prefetch stats for visible groups (by (model, condition))
  useEffect(() => {
    if (mode !== "GROUP" || !groups?.length) return;
    const selCond = selectedConditionBand(conds) || "";
    const keys = [];
    for (const g of groups) {
      const k = getStatsKey(g.model, selCond || (g?.conditionBand || g?.condition || "").toUpperCase() || "");
      if (k && !statsByModel[k]) keys.push(k);
    }
    if (!keys.length) return;
    fetchModelStatsBatch(keys).then((data) => {
      setStatsByModel((prev) => ({ ...prev, ...(data?.stats || {}) }));
    }).catch(() => {});
  }, [mode, groups, JSON.stringify(conds)]);

  // FLAT VIEW: prefetch stats for visible items (by (model, condition))
  useEffect(() => {
    if (mode !== "FLAT" || !flat?.length) return;
    const selCond = selectedConditionBand(conds) || "";
    const keys = [];
    for (const o of flat) {
      const modelKey = getModelKey(o);
      const condParam = (o?.conditionBand || o?.condition || "").toUpperCase() || selCond || "";
      const k = getStatsKey(modelKey, condParam);
      if (k && !statsByModel[k]) keys.push(k);
    }
    const uniqKeys = uniq(keys);
    if (!uniqKeys.length) return;
    fetchModelStatsBatch(uniqKeys).then((data) => {
      setStatsByModel((prev) => ({ ...prev, ...(data?.stats || {}) }));
    }).catch(() => {});
  }, [mode, flat, JSON.stringify(conds)]);

  // SERIES: lazily prefetch on expand
  const onExpandGroup = async (g) => {
    const model = g?.model;
    if (!model || seriesByModel[model]) return;
    try {
      const json = await fetchSeries(model, 90);
      setSeriesByModel((prev) => ({ ...prev, [model]: json?.series || [] }));
    } catch {}
  };

  const resultCount = mode === "GROUP" ? groups.length : flat.length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="text-sm text-gray-500">
          {loading ? "Loading..." : `${resultCount} result${resultCount === 1 ? "" : "s"}`}
          {ts ? ` · updated ${timeAgo(ts)}` : ""}
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-md border px-2 py-1 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="GROUP">Group view</option>
            <option value="FLAT">Flat view</option>
          </select>
          <select className="rounded-md border px-2 py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="POPULAR">Popular</option>
            <option value="NEWEST">Newest</option>
            <option value="PRICE_ASC">Price ↑</option>
            <option value="PRICE_DESC">Price ↓</option>
          </select>
        </div>
      </div>

      {/* Filters (quick) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyComplete} onChange={(e) => setOnlyComplete(e.target.checked)} />
          Only complete putters
        </label>
        <div className="flex items-center gap-1">
          <input className="w-24 rounded-md border px-2 py-1 text-sm" placeholder="Min $" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
          <span className="text-gray-400">–</span>
          <input className="w-24 rounded-md border px-2 py-1 text-sm" placeholder="Max $" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
        </div>
        <div className="flex items-center gap-1">
          {["MINT","EXCELLENT","GOOD","FAIR"].map((c) => (
            <label key={c} className={cx("cursor-pointer rounded border px-2 py-1 text-xs", conds.includes(c) ? "bg-gray-900 text-white" : "bg-white")}>
              <input type="checkbox" className="mr-1" checked={conds.includes(c)} onChange={(e) => {
                const on = e.target.checked;
                setConds((prev) => on ? uniq([...(prev||[]), c]) : (prev || []).filter((x) => x !== c));
              }} />
              {c}
            </label>
          ))}
        </div>
      </div>

      {/* MODE SWITCH */}
      {mode === "GROUP" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const isOpen = !!g._open;
            const ser = seriesByModel[g.model] || [];
            const domLen = Number.isFinite(g?.dominant?.shaftLength) ? Number(g.dominant.shaftLength) : null;

            // group condition param (selected filter first, else inferred from group)
            const groupCond =
              selectedConditionBand(conds) ||
              (g?.conditionBand || g?.condition || "").toUpperCase() ||
              "";

            const statsKey = getStatsKey(g.model, groupCond);
            const stats = statsByModel[statsKey] || null;

            const ordered = Array.isArray(g.offers) ? g.offers.slice().sort((a,b) => Number(a.price) - Number(b.price)) : [];
            const bestUrl = ordered.length ? ordered[0]?.url : null;

            const fair = fairPriceBadge(g.bestPrice, stats);

            return (
              <div key={g.model + groupCond} className="rounded-lg border p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{g.model}</div>
                    <div className="mt-0.5 text-xs text-gray-600">{g.offers?.length || 0} active listings</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {g?.dominant?.hand && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                          {g.dominant.hand}
                        </span>
                      )}
                      {Number.isFinite(domLen) && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          ~{domLen}&quot;
                        </span>
                      )}

                      {/* New smarter fair price badge (based on stats.p50) */}
                      <SmartPriceBadge price={Number(g.bestPrice)} baseStats={stats} className="ml-1" />

                      {/* (Optional) quick chip */}
                      {fair && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium text-white
                          ${fair.tone === "orange" ? "bg-orange-600" : fair.tone === "emerald" ? "bg-emerald-600" : "bg-green-600"}`}>
                          {fair.label}
                        </span>
                      )}
                    </div>

                    <div className="mt-2">
                      <SmartPriceBadge
                        price={Number(g.bestPrice)}
                        baseStats={stats}
                        variantStats={null}
                        title={ordered?.[0]?.title || g.model}
                        specs={ordered?.[0]?.specs}
                        brand={g?.brand}
                        showHelper
                      />
                    </div>

                    {/* Lows row (on expand) */}
                    {isOpen && (
                      <div className="mt-2 text-xs text-gray-600">
                        <span className="mr-2">Lowest:</span>
                        {ordered.slice(0, 3).map((o, i) => (
                          <a key={o.url + i} href={o.url} target="_blank" rel="noreferrer" className="mr-2 underline">
                            {formatPrice(o.price, o.currency)}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ml-3 shrink-0">
                    <PriceSparkline series={ser} width={120} height={36} />
                    <div className="mt-1 text-right text-[10px] text-gray-500">Asking-price trend · 90d</div>
                  </div>
                </div>

                {/* Expand */}
                <div className="mt-3 flex items-center justify-between">
                  <a href={bestUrl || "#"} target="_blank" rel="noreferrer" className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white">
                    See best deal
                  </a>
                  <button
                    className="rounded-md border px-2 py-1 text-xs"
                    onClick={() => {
                      g._open = !g._open;
                      setGroups([...groups]);
                      if (g._open) onExpandGroup(g);
                    }}
                  >
                    {isOpen ? "Hide listings" : "Show listings"}
                  </button>
                </div>

                {/* Expanded listings */}
                {isOpen && (
                  <div className="mt-3 divide-y">
                    {ordered.map((o) => {
                      return (
                        <div key={o.url} className="flex items-start gap-3 py-2">
                          <img src={o.image || "/placeholder.png"} alt="" className="h-12 w-12 rounded object-cover" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <a href={o.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium underline">
                                {o.title}
                              </a>
                              <div className="ml-2 flex items-center gap-2">
                                <span className="text-sm font-semibold">{formatPrice(o.price, o.currency)}</span>
                              </div>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              <div className="truncate text-sm font-medium">
                                {o.retailer}
                                {o?.seller?.username && (
                                  <>
                                    {/* Per-listing badge using (model, condition) stats */}
                                    <SmartPriceBadge
                                      price={Number(o.price)}
                                      baseStats={statsByModel[getStatsKey(
                                        getModelKey(o),
                                        ((o?.conditionBand || o?.condition || "").toUpperCase() || selectedConditionBand(conds) || "")
                                      )] || null}
                                      variantStats={null}
                                      title={o.title}
                                      specs={o.specs}
                                      brand={g?.brand}
                                      className="mr-2"
                                    />
                                    <span className="ml-2 text-xs text-gray-500">
                                      @{o.seller.username}
                                    </span>
                                  </>
                                )}
                                {typeof o?.seller?.feedbackPct === "number" && (
                                  <span className="ml-2 rounded-full bg-gray-100 px-2 py-[2px] text-[11px] font-medium text-gray-700">
                                    {o.seller.feedbackPct.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                              {o?.specs?.hand && (
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                                  {o.specs.hand}
                                </span>
                              )}
                              {o?.specs?.length && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                  ~{o.specs.length}&quot;
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // FLAT VIEW
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flat.map((o) => {
            const model = getModelKey(o);
            const selCond = selectedConditionBand(conds) || "";
            const condParam = (o?.conditionBand || o?.condition || "").toUpperCase() || selCond || "";
            const statsKey = getStatsKey(model, condParam);
            const stats = statsByModel[statsKey] || null;

            return (
              <article key={o.productId + o.url} className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <img src={o.image || "/placeholder.png"} alt="" className="h-14 w-14 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <a href={o.url} target="_blank" rel="noreferrer" className="truncate text-sm font-medium underline">
                        {o.title}
                      </a>

                      <div className="ml-2 flex items-center gap-2">
                        {/* Flat-view badge: uses (model, condition) stats */}
                        <SmartPriceBadge
                          price={Number(o.price)}
                          baseStats={statsByModel[getStatsKey(
                            getModelKey(o),
                            ((o?.conditionBand || o?.condition || "").toUpperCase() || selectedConditionBand(conds) || "")
                          )] || null}
                          variantStats={null}
                          title={o.title}
                          specs={o.specs}
                          brand={o.brand || ""}
                          className="mr-2"
                        />

                        <span className="text-base font-semibold">{formatPrice(o.price, o.currency)}</span>
                      </div>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">{o.retailer}</span>
                      {o?.specs?.hand && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                          {o.specs.hand}
                        </span>
                      )}
                      {o?.seller?.username && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                          @{o.seller.username}{typeof o?.seller?.feedbackPct === "number" ? ` · ${o.seller.feedbackPct.toFixed(1)}%` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Footer / snapshot */}
      <div className="mt-8">
        <MarketSnapshot />
      </div>
    </div>
  );
}
