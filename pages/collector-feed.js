import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
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

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Header />
      <h1>🧠 Collector Putter Feed</h1>

      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        {listings.length} listings found.
        {lastUpdated && (
          <> Last updated: {new Date(lastUpdated).toLocaleString()}</>
        )}
      </p>

      {listings.length > 0 ? (
        <ListingGrid listings={listings} />
      ) : (
        <p>No listings found.</p>
      )}
    </div>
  );
}
