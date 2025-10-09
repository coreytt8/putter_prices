// pages/index.js
// Add this to the top of pages/index.js (and optionally collector-feed.js)

<nav style={{ marginBottom: '2rem' }}>
  <a href="/" style={{ marginRight: '1rem' }}>🏠 Home</a>
  <a href="/collector-feed" style={{ marginRight: '1rem' }}>🕵️ Collector Feed</a>
  <a href="/headcovers-feed">🧢 Headcovers Feed</a>
</nav>



import Header from '@/components/Header';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [topListings, setTopListings] = useState([]);

  useEffect(() => {
    fetch('/api/collectors')
      .then(res => res.json())
      .then(data => {
        const listings = (data.listings || []).slice(0, 4); // Top 4
        setTopListings(listings);
      });
  }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <Header />
      <h1>PutterIQ</h1>
      <p>The ultimate collector guide for putters & headcovers ⛳️</p>

      <h2>🔥 Top Collector Finds</h2>
      <div style={{
        display: 'grid',
        gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        marginTop: '1rem'
      }}>
        {topListings.map(item => (
          <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" style={{
            border: '1px solid #ccc',
            borderRadius: '8px',
            overflow: 'hidden',
            textDecoration: 'none',
            color: '#111',
            background: '#fff',
            transition: 'box-shadow 0.2s ease'
          }}>
            {item.image && (
              <img
                src={item.image}
                alt={item.title}
                style={{ width: '100%', height: '200px', objectFit: 'cover' }}
              />
            )}
            <div style={{ padding: '0.75rem' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 0.25rem' }}>{item.title}</h3>
              <p style={{ margin: 0, color: '#555' }}><strong>{item.price}</strong></p>
              <p style={{ fontSize: '0.75rem', color: '#999' }}>Search: {item.term}</p>
            </div>
          </a>
        ))}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <Link href="/collector-feed" style={{
          display: 'inline-block',
          padding: '0.75rem 1.25rem',
          background: '#000',
          color: '#fff',
          borderRadius: '6px',
          textDecoration: 'none',
        }}>
          View Full Collector Feed →
        </Link>
      </div>
    </div>
  );
}
