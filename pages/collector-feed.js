import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('recent');
  const [total, setTotal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(
          `/api/collectors?q=${encodeURIComponent(searchTerm)}&page=${page}&sort=${sort}`
        );
        const data = await res.json();
        const listingsData = data.listings || {};
        setListings(listingsData.items || []);
        setTotal(listingsData.total || 0);
        setLastUpdated(listingsData.timestamp || null);
      } catch (err) {
        console.error('❌ Fetch error:', err);
      }
    };
    fetchData();
  }, [searchTerm, page, sort]);

  const totalPages = Math.ceil(total / 10);

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <Header />
      <h1>Putter and Headcovers</h1>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <input
          placeholder="Search putters or covers..."
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setPage(1);
          }}
          style={{ flex: 1, minWidth: '250px', padding: '0.5rem' }}
        />
        <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}>
          <option value="recent">Recently Added</option>
          <option value="lowToHigh">Price: Low to High</option>
          <option value="highToLow">Price: High to Low</option>
          <option value="alpha">Alphabetical</option>
        </select>
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
            <button onClick={() => setPage(p => Math.min(p + 1, totalPages))} disabled={page >= totalPages}>
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
