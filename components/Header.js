// components/Header.js

import Link from 'next/link';

export default function Header() {
  return (
    <nav style={{
      padding: '1rem 2rem',
      backgroundColor: '#f5f5f5',
      marginBottom: '2rem',
      borderBottom: '1px solid #ddd',
      display: 'flex',
      gap: '1rem'
    }}>
      <Link href="/">🏠 Home</Link>
      <Link href="/collector-feed">🕵️ Collector Feed</Link>
      <Link href="/headcovers-feed">🧢 Headcovers Feed</Link>
    </nav>
  );
}
