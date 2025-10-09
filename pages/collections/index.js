// pages/collection/index.js

import Link from 'next/link';
import Image from 'next/image';
import styles from '@/styles/Collection.module.css';
import { COLLECTOR_PUTTERS } from '@/lib/collectorCatalog';

export default function CollectionPage() {
  return (
    <div className={styles.container}>
      <h1>Collector Showcase</h1>
      <p>Explore rare and iconic putters from golf history 🏌️‍♂️</p>
      <div className={styles.grid}>
        {COLLECTOR_PUTTERS.map((putter) => (
          <Link key={putter.slug} href={`/collection/${putter.slug}`}>
            <div className={styles.card}>
              <Image
                src={putter.image}
                alt={putter.name}
                width={300}
                height={200}
                objectFit="cover"
              />
              <h3>{putter.name}</h3>
              <p>{putter.rarity} • {putter.year}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
