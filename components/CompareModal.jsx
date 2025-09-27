'use client';
import React from 'react';

function fmt(n, cur='USD') {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
  catch { return `$${n.toFixed(2)}`; }
}
function cell(v){ return <td className="border-t px-3 py-2 align-top text-sm">{v ?? '—'}</td>; }

export default function CompareModal({ open, onClose, items }) {
  if (!open) return null;

  const rows = [
    ['Title', (o)=> o.title],
    ['Retailer', (o)=> o.retailer],
    ['Price', (o)=> fmt(o.price, o.currency)],
    ['Shipping', (o)=> {
      const cur = o?.shippingDetails?.currency || o.currency;
      const shipVal = typeof o.shipping === 'number' && Number.isFinite(o.shipping) ? o.shipping : null;
      let detailVal = null;
      if (o?.shippingDetails?.cost != null) {
        const maybe = Number(o.shippingDetails.cost);
        if (Number.isFinite(maybe)) detailVal = maybe;
      }
      const val = shipVal ?? detailVal;
      return val != null ? fmt(val, cur) : '—';
    }],
    ['Total', (o)=> {
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
    }],
    ['Seller', (o)=> o?.seller?.username ? `@${o.seller.username}` : '—'],
    ['Feedback %', (o)=> (typeof o?.seller?.feedbackPct === 'number' ? `${o.seller.feedbackPct.toFixed(1)}%` : '—')],
    ['Dexterity', (o)=> (o?.specs?.dexterity || '').toUpperCase() || '—'],
    ['Head Type', (o)=> (o?.specs?.headType || '').toUpperCase() || '—'],
    ['Length', (o)=> Number.isFinite(Number(o?.specs?.length)) ? `${o.specs.length}"` : '—'],
    ['Shaft', (o)=> o?.specs?.shaft || '—'],
    ['Grip', (o)=> o?.specs?.grip || '—'],
    ['Loft', (o)=> o?.specs?.loft ? `${o.specs.loft}°` : '—'],
    ['Lie', (o)=> o?.specs?.lie ? `${o.specs.lie}°` : '—'],
    ['Head Weight', (o)=> o?.specs?.headWeight ? `${o.specs.headWeight}g` : '—'],
    ['Headcover', (o)=> o?.specs?.hasHeadcover ? 'Yes' : '—'],
    ['Condition', (o)=> o?.condition || '—'],
    ['Listed', (o)=> o?.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'],
    ['Link', (o)=> <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View</a>],
  ];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl rounded-t-2xl bg-white shadow-lg md:top-16 md:bottom-16">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-lg font-semibold">Compare listings</h3>
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">Close</button>
        </div>
        <div className="overflow-auto px-4 py-4">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="w-40 border-b px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Spec</th>
                {items.map(it => (
                  <th key={it._cid} className="border-b px-3 py-2 text-left text-sm font-medium">{it.title || it.model || it.retailer}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, getter]) => (
                <tr key={label}>
                  <td className="w-40 border-t bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">{label}</td>
                  {items.map(it => cell(getter(it)))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
