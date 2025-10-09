// components/ListingGrid.js

import ListingCard from './ListingCard';

export default function ListingGrid({ listings = [] }) {
  if (!Array.isArray(listings)) {
    console.error("❌ ListingGrid expected an array but got:", listings);
    return <p>Error: Invalid listings data</p>;
  }

  if (listings.length === 0) {
    return <p style={{ color: '#777' }}>No listings found.</p>;
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: '2rem',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        alignItems: 'stretch',
      }}
    >
      {listings.map((item) => (
        <ListingCard key={item.url || item.title} item={item} />
      ))}
    </div>
  );
}
