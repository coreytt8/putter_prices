"use client";

import { useEffect, useState } from "react";

export default function PuttersPage() {
  const [putters, setPutters] = useState([]);

  useEffect(() => {
    async function fetchPutters() {
      const res = await fetch("/api/putters");
      const data = await res.json();
      setPutters(data);
    }
    fetchPutters();
  }, []);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Available Putters</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {putters.map((p) => (
          <li key={p.id} className="border rounded p-3">
            <h2 className="font-semibold">{p.name}</h2>
            <p>${p.price.toFixed(2)}</p>
            <span className="text-sm text-gray-500">Source: {p.source}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
