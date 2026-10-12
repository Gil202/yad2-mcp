-- Additive migration: existing apartments remain intact.
CREATE TABLE IF NOT EXISTS listing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  price REAL NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  city TEXT NOT NULL,
  url TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_listing ON listing_history(apartment_id, id);
CREATE TABLE IF NOT EXISTS listing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('new_listing', 'price_drop')),
  observed_at TEXT NOT NULL,
  old_price REAL,
  new_price REAL NOT NULL,
  city TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  notified_at TEXT,
  lease_until TEXT,
  lease_token TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_pending ON listing_events(notified_at, city, id);
-- Baseline existing listings without notifying about old inventory.
INSERT INTO listing_history(apartment_id, observed_at, price, title, type, city, url)
SELECT id, updated_at, price, title, type, city, url FROM apartments a
WHERE NOT EXISTS (SELECT 1 FROM listing_history h WHERE h.apartment_id = a.id);

CREATE TRIGGER IF NOT EXISTS apartments_history_insert AFTER INSERT ON apartments
BEGIN
  INSERT INTO listing_history(apartment_id, observed_at, price, title, type, city, url)
  VALUES(NEW.id, NEW.updated_at, NEW.price, NEW.title, NEW.type, NEW.city, NEW.url);
  INSERT INTO listing_events(apartment_id, kind, observed_at, new_price, city, title, url)
  VALUES(NEW.id, 'new_listing', NEW.updated_at, NEW.price, NEW.city, NEW.title, NEW.url);
END;

CREATE TRIGGER IF NOT EXISTS apartments_history_update AFTER UPDATE ON apartments
WHEN OLD.price != NEW.price OR OLD.title != NEW.title OR OLD.city != NEW.city OR OLD.type != NEW.type OR OLD.url != NEW.url
BEGIN
  INSERT INTO listing_history(apartment_id, observed_at, price, title, type, city, url)
  VALUES(NEW.id, NEW.updated_at, NEW.price, NEW.title, NEW.type, NEW.city, NEW.url);
  INSERT INTO listing_events(apartment_id, kind, observed_at, old_price, new_price, city, title, url)
  SELECT NEW.id, 'price_drop', NEW.updated_at, OLD.price, NEW.price, NEW.city, NEW.title, NEW.url
  WHERE OLD.price > 0 AND NEW.price > 0 AND NEW.price < OLD.price;
END;
