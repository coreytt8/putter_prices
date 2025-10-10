// components/ListingGrid.js

import ListingCard from './ListingCard';

export default function ListingGrid({ listings = [] }) {
  return (
    <div style={{
      display: 'grid',
      gap: '1.5rem',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))'
    }}>
      {listings.map(item => (
        <ListingCard key={item.url || item.title} item={item} />
      ))}
    </div>
  );
}

