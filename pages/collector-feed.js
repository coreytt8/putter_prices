// pages/collector-feed.js

import { useEffect, useState } from 'react';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/collectors')
      .then(res => res.json())
      .then(data => {
        setListings(data.listings || []);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading collector listings...</p>;

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Live Collector Listings</h1>
      <p>Powered by the eBay Browse API 🔍</p>
      <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {listings.map((item) => (
          <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" style={{
            border: '1px solid #ccc', borderRadius: '8px', padding: '1rem', textDecoration: 'none', color: 'black'
          }}>
            {item.image && (
              <img src={item.image} alt={item.title} style={{ width: '100%', height: '200px', objectFit: 'cover' }} />
            )}
            <h3>{item.title}</h3>
            <p><strong>{item.price}</strong></p>
            <p style={{ fontSize: '0.8rem', color: '#666' }}>🔎 Search: {item.term}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
