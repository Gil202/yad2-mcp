-- D1 Database Schema for Yad2 Real Estate Scraper & MCP

CREATE TABLE IF NOT EXISTS apartments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('rent', 'sale')),
  city TEXT NOT NULL,
  neighborhood TEXT,
  address TEXT,
  price REAL NOT NULL DEFAULT 0,
  rooms REAL NOT NULL DEFAULT 0,
  floor INTEGER,
  square_meters REAL,
  description TEXT,
  url TEXT NOT NULL,
  images TEXT, -- JSON array of image URLs
  contact_name TEXT,
  contact_phone TEXT,
  attributes TEXT, -- JSON object of boolean feature flags
  scraped_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apartments_type ON apartments(type);
CREATE INDEX IF NOT EXISTS idx_apartments_city ON apartments(city);
CREATE INDEX IF NOT EXISTS idx_apartments_price ON apartments(price);
CREATE INDEX IF NOT EXISTS idx_apartments_rooms ON apartments(rooms);
CREATE INDEX IF NOT EXISTS idx_apartments_updated ON apartments(updated_at);

CREATE TABLE IF NOT EXISTS scrape_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  rent_count INTEGER NOT NULL DEFAULT 0,
  sale_count INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
