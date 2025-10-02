'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  TREND_ERROR_TEXT_CLASS,
  TREND_LOADING_CLASS,
  TREND_WRAPPER_CLASS,
} from './TrendingSparkline';

const conditionCache = new Map();
const inflightConditionCache = new Map();
const SHARED_SURFACE_CLASS = TREND_LOADING_CLASS.split(' ')
  .filter(
    (token) => token && token !== 'h-20' && token !== 'animate-pulse' && token !== 'rounded-xl'
  )
  .join(' ');

const fetchConditionDeltas = async (modelKey) => {
  if (conditionCache.has(modelKey)) {
    return conditionCache.get(modelKey);
  }
  if (inflightConditionCache.has(modelKey)) {
    return inflightConditionCache.get(modelKey);
  }

  const url = `/api/condition-deltas?model=${encodeURIComponent(modelKey)}`;
  const request = fetch(url, { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to load condition deltas');
      }
      const payload = await res.json();
      conditionCache.set(modelKey, payload);
      inflightConditionCache.delete(modelKey);
      return payload;
    })
    .catch((error) => {
      inflightConditionCache.delete(modelKey);
      throw error;
    });

  inflightConditionCache.set(modelKey, request);
  return request;
};

/**
 * Displays relative price premiums across condition bands for a putter model.
 *
 * Expected API response shape:
 * {
 *   ok: boolean,
 *   modelKey?: string,
 *   windowDays?: number,
 *   bandsCount: number,
 *   bands: Array<{
 *     condition: string,
 *     median: number, // price for the band
 *     premium: number, // delta vs baseline median (dollars)
 *     sampleSize: number,
 *   }>
 * }
 */
export default function ConditionChips({ model, className = '' }) {
  const shouldFetch = Boolean(model);
  const cachedData = shouldFetch ? conditionCache.get(model) ?? null : null;
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

    if (conditionCache.has(model)) {
      setData(conditionCache.get(model));
      setIsLoading(false);
      return;
    }

    let isActive = true;
    setIsLoading(true);
    setError(null);

    fetchConditionDeltas(model)
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
  }, [model, shouldFetch]);

  const processedBands = useMemo(() => {
    if (!data?.bands?.length) return [];

    return data.bands
      .map((band) => {
        const premium = Number(band?.premium);
        const median = Number(band?.median);
        const condition = band?.condition;
        if (!condition || !Number.isFinite(premium) || !Number.isFinite(median)) {
          return null;
        }
        const baseline = median - premium;
        if (!Number.isFinite(baseline) || baseline <= 0) {
          return null;
        }
        const percent = (premium / baseline) * 100;
        if (!Number.isFinite(percent)) {
          return null;
        }
        const formattedPercent = new Intl.NumberFormat('en-US', {
          signDisplay: 'always',
          maximumFractionDigits: Math.abs(percent) >= 10 ? 0 : 1,
          minimumFractionDigits: 0,
        }).format(percent);

        return {
          ...band,
          condition,
          premium,
          median,
          percent,
          formattedPercent,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.premium - a.premium);
  }, [data]);

  if (!shouldFetch || isLoading || error) {
    return null;
  }

  const bandsCount = data?.bandsCount ?? processedBands.length;
  if (!bandsCount || bandsCount < 2 || processedBands.length < 2) {
    return null;
  }

  const windowDays = Number.isFinite(Number(data?.windowDays))
    ? Number(data.windowDays)
    : null;

  const wrapperClassName = [
    TREND_WRAPPER_CLASS,
    'flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const badgeClassName = [
    TREND_ERROR_TEXT_CLASS,
    'inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide',
    SHARED_SURFACE_CLASS,
  ]
    .filter(Boolean)
    .join(' ');

  const chipBaseClass = [
    'inline-flex items-center rounded-full px-3 py-1.5 shadow-sm ring-1 ring-slate-200',
    SHARED_SURFACE_CLASS,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClassName}>
      {windowDays ? <span className={badgeClassName}>Last {windowDays}d</span> : null}
      {processedBands.map((band) => {
        const directionClass = band.percent >= 0 ? 'text-emerald-600' : 'text-rose-600';
        return (
          <span key={band.condition} className={chipBaseClass}>
            <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {band.condition}
            </span>
            <span className={`text-sm ${directionClass}`}>{band.formattedPercent}%</span>
          </span>
        );
      })}
    </div>
  );
}
