// pages/headcovers-feed.js

import { useEffect, useState } from 'react';

export default function HeadcoversFeed() {
  const [listings, setListings] = useState([]);
  const [filterTerm, setFilterTerm] = useState("");
  const [minPrice, setMinPrice] = useState(0);

  useEffect(() => {
    fetch('/api/headcovers')
      .then(res => res.json())
      .then(data => {
        setListings(data.listings || []);
      });
  }, []);

  const filteredListings = listings.filter(item =>
    item.title.toLowerCase().includes(filterTerm.toLowerCase()) &&
    parseFloat(item.price) >= minPrice
  );

  return (
    <div style={{ padding: '2rem' }}>
      <h1>🧢 Rare Headcovers Feed</h1>
      <p>Live collector listings for rare golf headcovers</p>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search headcover name..."
          value={filterTerm}
          onChange={(e) => setFilterTerm(e.target.value)}
          style={{ marginRight: '1rem', padding: '0.5rem' }}
        />
        <input
          type="number"
          placeholder="Min Price"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          style={{ padding: '0.5rem' }}
        />
      </div>

      <div style={{
        display: 'grid',
        gap: '2rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))'
      }}>
        {filteredListings.map(item => (
          <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" style={{
            border: '1px solid #ccc',
            borderRadius: '8px',
            padding: '1rem',
            textDecoration: 'none',
            color: 'black'
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
