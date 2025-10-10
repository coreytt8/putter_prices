// components/ListingCard.js

// Define badge keywords you care about
const BADGE_KEYWORDS = [
  'limited', 'tour', 'vault', 'prototype', 'circle t', 'custom', 'craft', 'batch'
];

function getBadges(title = '') {
  const lower = title.toLowerCase();
  return BADGE_KEYWORDS.filter(b => lower.includes(b));
}

export default function ListingCard({ item }) {
  const badges = getBadges(item.title);

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px' }}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          textDecoration: 'none',
          color: 'inherit',
          transition: 'transform 0.2s ease'
        }}
        className="listing-link"
      >
        {item.image && (
          <img
            src={item.image}
            alt={item.title}
            style={{
              width: '100%',
              height: '200px',
              objectFit: 'cover'
            }}
          />
        )}
        <div style={{ padding: '0.75rem', background: '#fff' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
            {item.title}
          </h3>
          <p style={{ margin: 0, fontWeight: 'bold' }}>{item.price}</p>
        </div>
      </a>

      {/* Badge Overlay */}
      {badges.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '0.5rem',
          left: '0.5rem',
          display: 'flex',
          gap: '0.5rem',
        }}>
          {badges.map((b, i) => (
            <span
              key={i}
              style={{
                background: 'rgba(255, 0, 0, 0.8)',
                color: 'white',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                textTransform: 'uppercase'
              }}
            >
              {b}
            </span>
          ))}
        </div>
      )}

      {/* Hover Overlay with extra details */}
      <div className="hover-details" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.5)',
        opacity: 0,
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem',
        textAlign: 'center',
        transition: 'opacity 0.2s ease'
      }}>
        <p style={{ margin: '0.25rem 0' }}>{item.term}</p>
        {/* You can add extra fields if available */}
        <p style={{ margin: '0.25rem 0' }}>{item.title}</p>
        <p style={{ margin: '0.25rem 0' }}>{item.price}</p>
      </div>

      <style jsx>{`
        .listing-link:hover {
          transform: scale(1.02);
        }
        .listing-link:hover + .hover-details,
        .listing-link:focus + .hover-details {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

