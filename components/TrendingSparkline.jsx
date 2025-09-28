"use client";

import { useEffect, useState } from "react";
import PriceSparkline from "./PriceSparkline";

const cache = new Map();

function mapSeriesPayload(payload) {
  if (!payload || !Array.isArray(payload.series)) return [];
  return payload.series
    .map((row) => {
      const rawTs = row.day ?? row.ts ?? row.date ?? row.x;
      const rawTotal = row.median ?? row.total ?? row.price ?? row.y ?? row.value;

      let ts = Number.isFinite(rawTs) ? Number(rawTs) : NaN;
      if (!Number.isFinite(ts) && rawTs != null) {
        const parsed = rawTs instanceof Date ? rawTs.getTime() : Date.parse(rawTs);
        ts = Number.isFinite(parsed) ? parsed : NaN;
      }

      const total = Number(rawTotal);

      if (!Number.isFinite(ts) || !Number.isFinite(total)) return null;
      return { ts, total };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

function fetchSeries(modelKey) {
  if (!modelKey) return Promise.resolve([]);

  const cached = cache.get(modelKey);
  if (cached) {
    if (cached.status === "fulfilled") return Promise.resolve(cached.data);
    if (cached.status === "rejected") return Promise.reject(cached.error);
    return cached.promise;
  }

  const promise = fetch(`/api/analytics/series?model=${encodeURIComponent(modelKey)}`)
    .then(async (res) => {
      if (!res.ok) throw new Error("Failed to load market trend");
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed to load market trend");
      return mapSeriesPayload(json);
    })
    .then((data) => {
      cache.set(modelKey, { status: "fulfilled", data });
      return data;
    })
    .catch((error) => {
      cache.set(modelKey, { status: "rejected", error });
      throw error;
    });

  cache.set(modelKey, { status: "pending", promise });
  return promise;
}

export default function TrendingSparkline({ modelKey, className = "" }) {
  const [state, setState] = useState({ loading: !!modelKey, error: null, data: [] });
  const rootClass = ["mt-4", className].filter(Boolean).join(" ");

  useEffect(() => {
    let active = true;
    if (!modelKey) {
      setState({ loading: false, error: null, data: [] });
      return () => {
        active = false;
      };
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchSeries(modelKey)
      .then((data) => {
        if (!active) return;
        setState({ loading: false, error: null, data });
      })
      .catch((error) => {
        if (!active) return;
        setState({ loading: false, error: error.message || "Unable to load trend", data: [] });
      });

    return () => {
      active = false;
    };
  }, [modelKey]);

  if (state.loading) {
    return <div className={`${rootClass} h-16 w-full animate-pulse rounded-xl bg-slate-100`} aria-hidden />;
  }

  if (state.error) {
    return <p className={`${rootClass} text-xs text-rose-500`}>Market trend unavailable right now.</p>;
  }

  if (!state.data.length) {
    return <div className={`${rootClass} text-xs text-slate-400`}>Trend warming up…</div>;
  }

  return (
    <div className={rootClass}>
      <PriceSparkline data={state.data} height={64} showAverage={false} showMedian className="h-16" />
    </div>
  );
}
