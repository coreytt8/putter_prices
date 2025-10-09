// pages/collector-feed.js
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [filterTerm, setFilterTerm] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    const fetchListings = async () => {
      const query = filterTerm.trim();
      const url = `/api/collectors?q=${encodeURIComponent(query)}`;

      try {
        const res = await fetch(url);
        const data = await res.json();
        const payload = data?.listings || {};
        setListings(payload.items || []);
        setLastUpdated(payload.timestamp || null);
      } catch (err) {
        console.error("❌ Error fetching collectors:", err);
      }
    };

    fetchListings();
  }, [filterTerm]);

  const sorted = [...listings].sort((a, b) => {
    switch (sort) {
      case 'lowToHigh':
        return a.priceValue - b.priceValue;
      case 'highToLow':
        return b.priceValue - a.priceValue;
      case 'alpha':
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Header />
      <h1>🧠 Collector Putter Feed</h1>

      <div style={{ display: 'flex', gap: '1rem', margin: '1rem 0' }}>
        <input
          placeholder="Search for rare or tour putters"
          value={filterTerm}
          onChange={e => setFilterTerm(e.target.value)}
        />
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="recent">Recently Added</option>
          <option value="lowToHigh">Price: Low to High</option>
          <option value="highToLow">Price: High to Low</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        {sorted.length} results.
        {lastUpdated && <> Last updated: {new Date(lastUpdated).toLocaleString()}</>}
      </p>

      {sorted.length > 0 ? (
        <ListingGrid listings={sorted} />
      ) : (
        <p>No listings found.</p>
      )}
    </div>
  );
}
