'use client';

import { useEffect, useMemo, useState } from 'react';
import PriceSparkline from './PriceSparkline';

const seriesCache = new Map();
const inflightCache = new Map();

const fetchSeries = async (modelKey) => {
  if (seriesCache.has(modelKey)) {
    return seriesCache.get(modelKey);
  }
  if (inflightCache.has(modelKey)) {
    return inflightCache.get(modelKey);
  }

  const url = `/api/analytics/series?model=${encodeURIComponent(modelKey)}`;
  const request = fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to load trend data');
      }
      const payload = await res.json();
      seriesCache.set(modelKey, payload);
      inflightCache.delete(modelKey);
      return payload;
    })
    .catch((error) => {
      inflightCache.delete(modelKey);
      throw error;
    });

  inflightCache.set(modelKey, request);
  return request;
};

export default function TrendingSparkline({ modelKey, height = 72, className = '' }) {
  const shouldFetch = Boolean(modelKey);
  const cachedData = shouldFetch ? seriesCache.get(modelKey) ?? null : null;
  const [data, setData] = useState(cachedData);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(shouldFetch && !cachedData);

  useEffect(() => {
    if (!shouldFetch) {
      setData(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (seriesCache.has(modelKey)) {
      setData(seriesCache.get(modelKey));
      setIsLoading(false);
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setError(null);

    fetchSeries(modelKey)
      .then((payload) => {
        if (!isActive) return;
        setData(payload);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isActive) return;
        setError(err);
        setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [modelKey, shouldFetch]);

  const points = useMemo(() => {
    if (!data?.series?.length) return [];
    return data.series
      .map((row) => {
        const rawTs = row?.day ?? row?.ts ?? row?.date;
        let ts = null;
        if (typeof rawTs === 'string' || typeof rawTs === 'number') {
          ts = rawTs;
        } else if (rawTs instanceof Date) {
          ts = rawTs.toISOString();
        }
        const total = Number(row?.median ?? row?.total ?? row?.price);
        if (!ts || !Number.isFinite(total)) return null;
        return { ts, total };
      })
      .filter(Boolean);
  }, [data]);

  const wrapperClassName = ['mt-4', className].filter(Boolean).join(' ');

  if (!shouldFetch) {
    return (
      <div className={wrapperClassName}>
        <p className="text-xs text-slate-400">Trend data unavailable.</p>
      </div>
    );
  }

  if (isLoading) {
    const loadingClassName = [
      wrapperClassName,
      'h-20 rounded-xl bg-slate-100/80 animate-pulse',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={loadingClassName} aria-busy="true">
        <span className="sr-only">Trend loading</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={wrapperClassName}>
        <p className="text-xs text-slate-400">Trend unavailable.</p>
      </div>
    );
  }

  if (!points.length) {
    return (
      <div className={wrapperClassName}>
        <p className="text-xs text-slate-400">Trend loading…</p>
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <div className="rounded-xl bg-emerald-50/60 p-3">
        <PriceSparkline data={points} height={height} showMedian className="text-emerald-500" />
      </div>
    </div>
  );
}
