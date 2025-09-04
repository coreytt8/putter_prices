from database import SessionLocal, Product, init_db
from slugify import slugify  # if you don't have it: pip install python-slugify

def upsert_product(db, brand, model):
    slug = slugify(f"{brand}-{model}")
    q = f"{brand} {model} putter"
    p = db.query(Product).filter_by(slug=slug).first()
    if not p:
        db.add(Product(brand=brand, model=model, slug=slug, query=q))

if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    upsert_product(db, "Odyssey", "White Hot OG 1")
    upsert_product(db, "Scotty Cameron", "Newport 2")
    upsert_product(db, "Ping", "Anser 2")
    db.commit()
    db.close()
    print("✅ Seeded products")

