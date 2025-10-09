// pages/collection/[slug].js

import { useRouter } from 'next/router';
import Image from 'next/image';
import { COLLECTOR_PUTTERS } from '@/lib/collectorCatalog';
import styles from '@/styles/PutterDetail.module.css';

export default function PutterDetail() {
  const router = useRouter();
  const { slug } = router.query;

  const putter = COLLECTOR_PUTTERS.find(p => p.slug === slug);

  if (!putter) return <p>Loading or not found...</p>;

  return (
    <div className={styles.container}>
      <h1>{putter.name}</h1>
      <Image
        src={putter.image}
        width={600}
        height={400}
        alt={putter.name}
        objectFit="contain"
      />
      <div className={styles.specs}>
        <ul>
          <li><strong>Brand:</strong> {putter.brand}</li>
          <li><strong>Year:</strong> {putter.year}</li>
          <li><strong>Rarity:</strong> {putter.rarity}</li>
          <li><strong>Condition:</strong> {putter.condition}</li>
          <li><strong>Value Range:</strong> {putter.priceEstimate}</li>
        </ul>
      </div>
      <p>{putter.description}</p>
    </div>
  );
}
