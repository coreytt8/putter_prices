// pages/headcovers-feed.js

import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function HeadcoversFeed() {
  const [listings, setListings] = useState([]);
  const [filterTerm, setFilterTerm] = useState("");
  const [minPrice, setMinPrice] = useState(0);
  const [sortOrder, setSortOrder] = useState("default");
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetch('/api/headcovers')
      .then(res => res.json())
      .then(data => {
        const { items, timestamp } = data.listings || {};
        setListings(items || []);
        setLastUpdated(timestamp || null);
      });
  }, []);

  const filteredListings = listings.filter(item =>
    item.title.toLowerCase().includes(filterTerm.toLowerCase()) &&
    parseFloat(item.price) >= minPrice
  );

  const sortedListings = [...filteredListings].sort((a, b) => {
    const priceA = parseFloat(a.price);
    const priceB = parseFloat(b.price);

    switch (sortOrder) {
      case 'price-asc':
        return priceA - priceB;
      case 'price-desc':
        return priceB - priceA;
      case 'alpha':
        return a.title.localeCompare(b.title);
      case 'offers':
        const hasOfferA = /offer/i.test(a.title + a.term);
        const hasOfferB = /offer/i.test(b.title + b.term);
        return hasOfferB - hasOfferA;
      case 'default':
      default:
        return 0;
    }
  });

  return (
    <div style={{ padding: '2rem' }}>
      <Header />
      <h1>🧢 Rare Headcovers Feed</h1>
      <p>Live eBay listings for limited headcovers</p>

      {lastUpdated && (
        <p style={{ fontSize: '0.85rem', color: '#777' }}>
          Last updated: {new Date(lastUpdated).toLocaleString()}
        </p>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search headcover..."
          value={filterTerm}
          onChange={(e) => setFilterTerm(e.target.value)}
          style={{ marginRight: '1rem', padding: '0.5rem' }}
        />
        <input
          type="number"
          placeholder="Min Price"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          style={{ marginRight: '1rem', padding: '0.5rem' }}
        />
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          style={{ padding: '0.5rem' }}
        >
          <option value="default">Sort by: Recently Added</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="alpha">Alphabetical</option>
          <option value="offers">Most Offers</option>
        </select>
      </div>

      <ListingGrid listings={sortedListings} />
    </div>
  );
}

