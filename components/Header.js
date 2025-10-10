// components/Header.js

import Link from 'next/link';
import styles from './Header.module.css';

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <Link href="/" className={styles.logo}>PutterIQ</Link>
        <nav className={styles.nav}>
          <Link href="/collector-feed" className={styles.link}>Collectors</Link>
          <Link href="/headcover-feed" className={styles.link}>Headcovers</Link>
        </nav>
      </div>
    </header>
  );
}

