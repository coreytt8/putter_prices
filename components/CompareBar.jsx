'use client';
import React from 'react';

export default function CompareBar({ items, onRemove, onOpen, onClear }) {
  if (!items.length) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="text-xs uppercase tracking-wide text-gray-500">Compare:</span>
          {items.map((it) => (
            <button
              key={it._cid}
              className="group flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
              title={it.title || it.model || it.url}
              onClick={() => onRemove(it._cid)}
            >
              <span className="line-clamp-1 max-w-[160px]">{it.title || it.model || it.retailer}</span>
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 group-hover:bg-gray-200">×</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Clear
          </button>
          <button
            disabled={items.length < 2}
            onClick={onOpen}
            className={`rounded-md px-3 py-1.5 text-sm text-white ${items.length < 2 ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            Compare {items.length}
          </button>
        </div>
      </div>
    </div>
  );
}
