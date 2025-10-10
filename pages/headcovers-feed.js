import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function HeadcoverFeed() {
  const [listings, setListings] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const res = await fetch(`/api/headcovers?page=${page}&q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();

        setListings(data.listings.items || []);
        setTotal(data.listings.total || 0);
        setLastUpdated(data.listings.timestamp || null);
      } catch (err) {
        console.error("❌ Error fetching headcovers:", err);
      }
    };

    fetchListings();
  }, [page, searchTerm]);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setPage(1);
  };

  const totalPages = Math.ceil(total / 10);

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <Header />
      <h1>🎯 Headcover Collector Feed</h1>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        marginBottom: '1rem'
      }}>
        <input
          type="text"
          placeholder="Search rare headcovers..."
          value={searchTerm}
          onChange={handleSearchChange}
          style={{ flex: '1', minWidth: '250px', padding: '0.5rem' }}
        />
      </div>

      <p style={{ fontSize: '0.9rem', color: '#666' }}>
        {total} results found.
        {lastUpdated && <> Last updated: {new Date(lastUpdated).toLocaleString()}</>}
      </p>

      {listings.length > 0 ? (
        <>
          <ListingGrid listings={listings} />

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <button onClick={() => setPage(p => Math.max(p - 1, 1))} disabled={page === 1}>
              ⬅️ Prev
            </button>
            <span>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(p + 1, totalPages))} disabled={page === totalPages}>
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
