"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

const BAND_META = {
  ANY: { label: "All listings", color: "#2563eb" },
  NEW: { label: "Brand new", color: "#0ea5e9" },
  LIKE_NEW: { label: "Like new", color: "#10b981" },
  USED: { label: "Used", color: "#f97316" },
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  try {
    return currencyFormatter.format(value);
  } catch {
    return `$${value.toFixed(0)}`;
  }
}

function compactError(message) {
  if (!message) return "Unable to load history.";
  return message.length > 120 ? `${message.slice(0, 117)}…` : message;
}

export default function ModelHistoryChart({ model, windowDays = 180, className = "" }) {
  const cacheRef = useRef(new Map());
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!model) {
      setPayload(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const cached = cacheRef.current.get(model);
    if (cached) {
      setPayload(cached);
    }

    setLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await fetch(
          `/api/model-history?model=${encodeURIComponent(model)}&window=${windowDays}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const json = await response.json();
        if (!json?.ok) {
          throw new Error(json?.error || "Unexpected response");
        }
        if (cancelled) return;
        cacheRef.current.set(model, json);
        setPayload(json);
        setError(null);
      } catch (err) {
        if (cancelled || err?.name === "AbortError") return;
        setError(err?.message || "Failed to load model history");
        if (!cached) {
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [model, windowDays]);

  const chartData = payload?.series?.points ?? [];
  const availableBands = useMemo(() => {
    const bands = payload?.series?.bands ?? [];
    return bands.filter((band) => BAND_META[band]);
  }, [payload]);

  const effectiveWindow = useMemo(() => {
    return (
      payload?.resolved?.windowDays ??
      payload?.requested?.windowDays ??
      windowDays
    );
  }, [payload, windowDays]);

  const showChart = chartData.length >= 2 && availableBands.length > 0;

  const tooltipContent = useMemo(() => {
    if (!availableBands.length) return null;
    const bands = [...availableBands];

    // Custom tooltip component scoped to available bands
    // eslint-disable-next-line react/display-name
    return ({ active, payload: tooltipPayload }) => {
      if (!active || !tooltipPayload?.length) return null;
      const point = tooltipPayload[0]?.payload;
      if (!point) return null;

      return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-md">
          <div className="text-[11px] font-medium text-gray-500">{point.date}</div>
          <div className="mt-2 space-y-1">
            {bands.map((band) => {
              const meta = BAND_META[band];
              const value = point[band];
              if (!Number.isFinite(value)) return null;
              const sample = point[`n_${band}`];
              return (
                <div key={band} className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="text-[11px] font-medium text-gray-600">
                      {meta.label}
                    </span>
                  </span>
                  <span className="font-semibold text-gray-900">{formatCurrency(value)}</span>
                  <span className="text-[11px] text-gray-500">n={sample ?? 0}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    };
  }, [availableBands]);

  const wrapperClassName = [
    "w-full rounded-2xl border border-gray-200 bg-white p-4 shadow-sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClassName}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Median price history</h3>
          <p className="text-xs text-gray-500">Tracked condition bands over time.</p>
        </div>
        <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-[11px] text-gray-600">
          Last {effectiveWindow}d
        </span>
      </div>

      {!model ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          Select a model to view history.
        </div>
      ) : loading && !chartData.length ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          Loading history…
        </div>
      ) : error && !chartData.length ? (
        <div className="rounded-lg border border-dashed border-rose-200 bg-rose-50 p-4 text-sm text-rose-600">
          {compactError(error)}
        </div>
      ) : !showChart ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500">
          Not enough history yet.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => value}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                dy={6}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={{ stroke: "#e5e7eb" }}
              />
              <YAxis
                tickFormatter={(value) => formatCurrency(value)}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                width={72}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={{ stroke: "#e5e7eb" }}
              />
              {tooltipContent ? <Tooltip content={tooltipContent} /> : null}
              <Legend
                verticalAlign="top"
                align="right"
                height={32}
                iconType="circle"
                formatter={(value) => BAND_META[value]?.label ?? value}
              />
              {availableBands.map((band) => {
                const meta = BAND_META[band];
                return (
                  <Line
                    key={band}
                    type="monotone"
                    dataKey={band}
                    stroke={meta.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
