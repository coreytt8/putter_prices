from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.sql import func

DATABASE_URL = "sqlite:///./putters.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

class Product(Base):
    __tablename__ = "product"
    id = Column(Integer, primary_key=True)
    brand = Column(String, index=True)
    model = Column(String, index=True)
    slug = Column(String, unique=True, index=True)
    query = Column(String)  # e.g., "Odyssey White Hot OG putter"

class PriceSnapshot(Base):
    __tablename__ = "price_snapshot"
    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("product.id"))
    source = Column(String)  # "ebay"
    price_cents = Column(Integer)
    captured_at = Column(DateTime(timezone=True), server_default=func.now())
    product = relationship("Product")

class Alert(Base):
    __tablename__ = "alert"
    id = Column(Integer, primary_key=True)
    email = Column(String, index=True)
    product_id = Column(Integer, ForeignKey("product.id"))
    threshold_cents = Column(Integer)
    active = Column(Integer, default=1)  # 1 true, 0 false
    product = relationship("Product")

def init_db():
    Base.metadata.create_all(bind=engine)

