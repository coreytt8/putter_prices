import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

const COLLECTOR_KEYWORDS = ['limited', 'tour', 'circle t', 'prototype', 'rare', 'vault', 'custom', 'craft batch'];

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [sort, setSort] = useState('recent');
  const [filterTerm, setFilterTerm] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetch(`/api/collectors`)
      .then(res => res.json())
      .then(data => {
        console.log("📦 Collector API response:", data);
        const payload = data?.listings || {};
        setListings(payload.items || []);
        setLastUpdated(payload.timestamp || null);
      })
      .catch(err => {
        console.error("❌ Error fetching collectors:", err);
      });
  }, []);

  useEffect(() => {
    let result = [...listings];

    const term = filterTerm.trim().toLowerCase();

    result = result.filter(item => {
      const title = item.title?.toLowerCase() || '';
      const matchesTerm = !term || title.includes(term);
      const hasCollectorKeyword = COLLECTOR_KEYWORDS.some(keyword =>
        title.includes(keyword)
      );
      return matchesTerm && hasCollectorKeyword;
    });

    switch (sort) {
      case 'lowToHigh':
        result.sort((a, b) => a.priceValue - b.priceValue);
        break;
      case 'highToLow':
        result.sort((a, b) => b.priceValue - a.priceValue);
        break;
      case 'alpha':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        break;
    }

    setFiltered(result);
  }, [listings, filterTerm, sort]);

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Header />
      <h1>🧠 Collector Putter Feed</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', margin: '1rem 0' }}>
        <input
          placeholder="Search collector titles (e.g. Spider, Circle T, Olson...)"
          value={filterTerm}
          onChange={e => setFilterTerm(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="recent">Recently Added</option>
          <option value="lowToHigh">Price: Low to High</option>
          <option value="highToLow">Price: High to Low</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        {filtered.length} results.
        {lastUpdated && <> Last updated: {new Date(lastUpdated).toLocaleString()}</>}
      </p>

      {filtered.length > 0 ? (
        <ListingGrid listings={filtered} />
      ) : (
        <p>No listings found.</p>
      )}
    </div>
  );
}
