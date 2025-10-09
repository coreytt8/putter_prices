// components/ListingCard.js

export default function ListingCard({ item }) {
  return (
    <a href={item.url} target="_blank" rel="noopener noreferrer" style={{
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '1rem',
      textDecoration: 'none',
      color: 'black',
      background: '#fff',
      transition: 'box-shadow 0.2s ease'
    }}>
      {item.image && (
        <img
          src={item.image}
          alt={item.title}
          style={{
            width: '100%',
            height: '200px',
            objectFit: 'cover',
            borderRadius: '4px',
            marginBottom: '0.5rem'
          }}
        />
      )}
      <h3>{item.title}</h3>
      <p><strong>{item.price}</strong></p>
      <p style={{ fontSize: '0.8rem', color: '#666' }}>🔎 {item.term}</p>
    </a>
  );
}
