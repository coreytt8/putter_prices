"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [putters, setPutters] = useState([]);

  useEffect(() => {
    async function fetchPutters() {
      try {
        const res = await fetch("http://localhost:8000/putters");
        if (!res.ok) throw new Error("Failed to fetch putters");
        const data = await res.json();
        setPutters(data);
      } catch (err) {
        console.error("Error fetching putters:", err);
      }
    }

    fetchPutters();
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Putter Price Comparison</h1>
      {putters.length === 0 ? (
        <p>Loading putters...</p>
      ) : (
        <ul>
          {putters.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> – ${p.price} ({p.source})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
