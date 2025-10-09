import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import ListingGrid from '@/components/ListingGrid';

export default function CollectorFeed() {
  const [listings, setListings] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [sort, setSort] = useState('recent');
  const [filterTerm, setFilterTerm] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    fetch(`/api/collectors`)
      .then(res => res.json())
      .then(data => {
        const payload = data?.listings || {};
        setListings(payload.items || []);
        setLastUpdated(payload.timestamp || null);
      })
      .catch(err => {
        console.error("❌ Error fetching collectors:", err);
      });
  }, []);

  useEffect(() => {
    let result = [...listings];

    result = result.filter(item => {
      const titleMatch = item.title?.toLowerCase().includes(filterTerm.toLowerCase());
      const brandMatch = filterBrand
        ? item.brand?.toLowerCase().includes(filterBrand.toLowerCase())
        : true;
      const modelMatch = filterModel
        ? item.model?.toLowerCase().includes(filterModel.toLowerCase())
        : true;

      return titleMatch && brandMatch && modelMatch;
    });

    switch (sort) {
      case 'lowToHigh':
        result.sort((a, b) => a.priceValue - b.priceValue);
        break;
      case 'highToLow':
        result.sort((a, b) => b.priceValue - a.priceValue);
        break;
      case 'alpha':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'recent':
      default:
        break;
    }

    setFiltered(result);
  }, [listings, filterTerm, filterBrand, filterModel, sort]);

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <Header />
      <h1>🧠 Collector Putter Feed</h1>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', margin: '1rem 0' }}>
        <input
          placeholder="Search by title"
          value={filterTerm}
          onChange={e => setFilterTerm(e.target.value)}
        />
        <input
          placeholder="Brand"
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
        />
        <input
          placeholder="Model"
          value={filterModel}
          onChange={e => setFilterModel(e.target.value)}
        />
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="recent">Recently Added</option>
          <option value="lowToHigh">Price: Low to High</option>
          <option value="highToLow">Price: High to Low</option>
          <option value="alpha">Alphabetical</option>
        </select>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#666' }}>
        {filtered.length} results.
        {lastUpdated && <> Last updated: {new Date(lastUpdated).toLocaleString()}</>}
      </p>

      {filtered.length > 0 ? (
        <ListingGrid listings={filtered} />
      ) : (
        <p>No listings found.</p>
      )}
    </div>
  );
}
