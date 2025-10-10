// pages/collector-feed.js

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const res = await fetch(
           `/api/collectors?q=${encodeURIComponent(searchTerm)}&page=${page}&limit=10&sort=${sort}`)
        );
        const data = await res.json();
        const payload = data?.listings || {};
        setListings(payload.items || []);
        setTotal(payload.total || 0);
        setLastUpdated(payload.timestamp || null);
      } catch (err) {
        console.error('❌ Fetch error:', err);
      }
    };

    fetchListings();
  }, [searchTerm, page]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setPage(1);
  };

  const totalPages = total ? Math.ceil(total / (listings.length || 1)) : 1;

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <Header />
      <h1>🧠 Collector Putter Feed</h1>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <input
          type="text"
          placeholder="Search putters or covers..."
          value={searchTerm}
          onChange={handleSearchChange}
          style={{ flex: '1', minWidth: '250px', padding: '0.5rem' }}
        />
      </div>

      <p style={{ fontSize: '0.9rem', color: '#666' }}>
        {total} results found.
        {lastUpdated && (
          <> Last updated: {new Date(lastUpdated).toLocaleString()}</>
        )}
      </p>

      {listings.length > 0 ? (
        <>
          <ListingGrid listings={listings} />

          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              justifyContent: 'center',
              gap: '1rem',
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
            >
              ⬅️ Prev
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
            >
              Next ➡️
            </button>
          </div>
        </>
      ) : (
        <p>No listings found.</p>
      )}
    </div>
  );
}
