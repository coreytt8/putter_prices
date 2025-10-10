// pages/index.js

import Header from '@/components/Header';
import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Header />
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏌️‍♂️ PutterIQ</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>
        Explore rare collector-grade golf putters and limited edition headcovers from across eBay — all in one place.
      </p>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        fontSize: '1.1rem'
      }}>
        <Link href="/collector-feed" style={linkStyle}>🔎 Collector Feed →</Link>
        <Link href="/headcovers-feed" style={linkStyle}>🧢 Headcovers Feed →</Link>
      </div>
    </div>
  );
}

const linkStyle = {
  padding: '1rem',
  border: '1px solid #ccc',
  borderRadius: '8px',
  background: '#fafafa',
  textDecoration: 'none',
  color: '#000',
  transition: 'background 0.2s ease',
};
