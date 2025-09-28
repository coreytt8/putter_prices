'use client';

import { useEffect, useMemo, useState } from 'react';
import CompareBar from './CompareBar';
import CompareTray from './CompareTray';

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function adaptDealToListing(deal, fallbackIndex = 0) {
  if (!deal || !deal.bestOffer) return null;

  const best = deal.bestOffer || {};
  const currency = best.currency || deal.currency || 'USD';
  const price = toNumber(best.price) ?? toNumber(deal.bestPrice);
  const shipping = toNumber(best.shipping);
  const total = toNumber(best.total) ?? (price != null && shipping != null ? price + shipping : null) ?? toNumber(deal.bestPrice);
  const observedAt = best.observedAt || best.createdAt || null;

  const baseId =
    best.itemId ||
    best.url ||
    (deal.modelKey ? `${deal.modelKey}-${fallbackIndex}` : deal.query ? `${deal.query}-${fallbackIndex}` : null) ||
    `deal-${fallbackIndex}`;

  const listing = {
    _cid: String(baseId),
    title: best.title || deal.label || deal.query || 'Smart Price listing',
    image: best.image || deal.image || null,
    url: best.url || null,
    price,
    total,
    currency,
    shipping,
    shippingDetails:
      shipping != null
        ? {
            cost: shipping,
            currency,
          }
        : undefined,
    retailer: best.retailer || deal.retailer || 'eBay',
    seller:
      best.sellerUsername || best.seller
        ? {
            username: best.sellerUsername || (typeof best.seller === 'string' ? best.seller : best?.seller?.username),
            feedbackPct: toNumber(best?.seller?.feedbackPct) ?? undefined,
          }
        : best?.seller ?? undefined,
    specs: best.specs || undefined,
    brand: best.brand || deal.brand || undefined,
    createdAt: observedAt,
  };

  return listing;
}

export default function HomepageCompareDemo({ deals = [] }) {
  const seeds = useMemo(() => {
    return deals
      .filter((deal) => deal?.bestOffer)
      .slice(0, 3)
      .map((deal, index) => adaptDealToListing(deal, index))
      .filter(Boolean);
  }, [deals]);

  const [activeIds, setActiveIds] = useState(() => seeds.map((item) => item._cid));
  const [hasInteracted, setHasInteracted] = useState(false);
  const [open, setOpen] = useState(() => seeds.length >= 2);

  useEffect(() => {
    setActiveIds((prev) => {
      const availableIds = seeds.map((item) => item._cid);
      if (!availableIds.length) return [];

      const next = prev.filter((id) => availableIds.includes(id));
      const unchanged =
        next.length === prev.length && next.every((id, index) => id === prev[index]);
      if (unchanged) return prev;
      if (next.length > 0) return next;

      if (!hasInteracted) {
        return availableIds;
      }

      return next;
    });
  }, [seeds, hasInteracted]);

  const itemLookup = useMemo(() => {
    const map = new Map();
    seeds.forEach((item) => {
      if (item?._cid) {
        map.set(item._cid, item);
      }
    });
    return map;
  }, [seeds]);

  const items = useMemo(() => activeIds.map((id) => itemLookup.get(id)).filter(Boolean), [activeIds, itemLookup]);

  useEffect(() => {
    if (items.length === 0 && open) {
      setOpen(false);
    }
  }, [items.length, open]);

  useEffect(() => {
    if (!hasInteracted && seeds.length >= 2) {
      setOpen(true);
    }
  }, [seeds.length, hasInteracted]);

  if (!seeds.length) {
    return null;
  }

  const handleRemove = (id) => {
    setActiveIds((prev) => prev.filter((itemId) => itemId !== id));
    setHasInteracted(true);
  };

  const handleClear = () => {
    setActiveIds([]);
    setHasInteracted(true);
    setOpen(false);
  };

  const handleOpen = () => {
    if (items.length > 0) {
      setOpen(true);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setHasInteracted(true);
  };

  return (
    <>
      <CompareTray open={open} items={items} onClose={handleClose} onRemove={handleRemove} onClear={handleClear} />
      <CompareBar items={items} onRemove={handleRemove} onClear={handleClear} onOpen={handleOpen} />
    </>
  );
}
