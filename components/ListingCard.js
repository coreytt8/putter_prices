// components/ListingCard.js

export default function ListingCard({ item }) {
  return (
    <div style={{
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '1rem',
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

      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginTop: '0.5rem',
          display: 'inline-block',
          padding: '0.4rem 0.8rem',
          background: '#000',
          color: '#fff',
          textDecoration: 'none',
          borderRadius: '4px',
          fontSize: '0.9rem',
        }}
      >
        View Listing →
      </a>
    </div>
  );
}
