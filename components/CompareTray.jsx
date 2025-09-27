'use client';
import { useMemo } from 'react';

function fmt(n, c = 'USD') {
  if (!Number.isFinite(Number(n))) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(Number(n));
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

export default function CompareTray({
  open,
  items = [],
  onClose,
  onRemove,     // (id) => void
  onClear,      // () => void
}) {
  const cols = useMemo(() => ([
    { key: 'image',    label: '' },
    { key: 'title',    label: 'Listing' },
    { key: 'price',    label: 'Price' },
    { key: 'shipping', label: 'Shipping' },
    { key: 'total',    label: 'Total' },
    { key: 'dex',      label: 'Dexterity' },
    { key: 'head',     label: 'Head' },
    { key: 'length',   label: 'Length' },
    { key: 'shaft',    label: 'Shaft' },
    { key: 'hc',       label: 'Headcover' },
    { key: 'seller',   label: 'Seller' },
    { key: 'rating',   label: 'Rating' },
    { key: 'age',      label: 'Listed' },
    { key: 'link',     label: '' },
  ]), []);

  return (
    <div className={`fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ${open ? 'translate-y-0' : 'translate-y-full'}`}>
      <div className="mx-auto max-w-6xl rounded-t-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm text-gray-600">
            Compare <span className="font-medium">{items.length}</span> listing{items.length === 1 ? '' : 's'}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClear}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            >
              Close
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-t border-gray-100 text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                {cols.map(c => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{c.label}</th>
                ))}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => {
                const id = o._cid || o.productId || o.url; // _cid is added by page.js for uniqueness
                const spec = o.specs || {};
                const dex  = (spec.dexterity || '').toUpperCase() || '—';
                const head = (spec.headType  || '').toUpperCase() || '—';
                const L    = Number.isFinite(Number(spec.length)) ? `${spec.length}"` : '—';
                const shaft = spec.shaft ? String(spec.shaft).toLowerCase() : '—';
                const hc = spec.hasHeadcover ? 'Yes' : '—';
                const age = o.createdAt ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
                  -Math.round((Date.now() - new Date(o.createdAt).getTime()) / 3600000), 'hour'
                ) : '—';
                const rating = typeof o?.seller?.feedbackPct === 'number' ? `${o.seller.feedbackPct.toFixed(1)}%` : '—';

                return (
                  <tr key={id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      {o.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image} alt="" className="h-12 w-12 rounded object-cover" />
                      ) : <div className="h-12 w-12 rounded bg-gray-100" />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-xs truncate font-medium">{o.title || o.retailer}</div>
                      <div className="text-xs text-gray-500">{o.retailer}{o?.seller?.username ? ` · @${o.seller.username}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{fmt(o.price, o.currency)}</td>
                    <td className="px-3 py-2">{
                      (() => {
                        const cur = o?.shippingDetails?.currency || o.currency;
                        const flat = typeof o.shipping === 'number' && Number.isFinite(o.shipping) ? o.shipping : null;
                        let detail = null;
                        if (o?.shippingDetails?.cost != null) {
                          const maybe = Number(o.shippingDetails.cost);
                          if (Number.isFinite(maybe)) detail = maybe;
                        }
                        const val = flat ?? detail;
                        return val != null ? fmt(val, cur) : '—';
                      })()
                    }</td>
                    <td className="px-3 py-2 font-semibold">{
                      (() => {
                        const totalVal = typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : null;
                        let priceVal = null;
                        if (typeof o.price === 'number' && Number.isFinite(o.price)) {
                          priceVal = o.price;
                        } else if (o.price != null) {
                          const maybe = Number(o.price);
                          if (Number.isFinite(maybe)) priceVal = maybe;
                        }
                        const shipVal = (() => {
                          if (typeof o.shipping === 'number' && Number.isFinite(o.shipping)) return o.shipping;
                          if (o?.shippingDetails?.cost != null) {
                            const maybe = Number(o.shippingDetails.cost);
                            if (Number.isFinite(maybe)) return maybe;
                          }
                          return 0;
                        })();
                        const val = totalVal != null ? totalVal : priceVal != null ? priceVal + shipVal : null;
                        return val != null ? fmt(val, o.currency) : '—';
                      })()
                    }</td>
                    <td className="px-3 py-2">{dex}</td>
                    <td className="px-3 py-2">{head}</td>
                    <td className="px-3 py-2">{L}</td>
                    <td className="px-3 py-2">{shaft}</td>
                    <td className="px-3 py-2">{hc}</td>
                    <td className="px-3 py-2">{o?.seller?.username ? `@${o.seller.username}` : '—'}</td>
                    <td className="px-3 py-2">{rating}</td>
                    <td className="px-3 py-2">{age}</td>
                    <td className="px-3 py-2">
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        View
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => onRemove?.(id)}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                        title="Remove from compare"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 1} className="px-3 py-8 text-center text-gray-500">
                    Nothing selected yet. Check a few listings to compare them side-by-side.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
