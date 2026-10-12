-- Preserve listings and history; old summary flags were not reliable evidence.
ALTER TABLE apartments ADD COLUMN details TEXT;
UPDATE apartments SET attributes = '{}';
CREATE INDEX IF NOT EXISTS idx_apartments_floor ON apartments(floor);
