import { Apartment, SearchFilters } from '../types';

export async function upsertApartments(
  db: D1Database,
  items: Apartment[],
  purgePrevious: boolean = false
): Promise<{ inserted: number; updated: number; deleted?: number }> {
  let deletedCount = 0;
  if (purgePrevious) {
    throw new Error('Purging is disabled to preserve listing history');
  }

  if (!items || items.length === 0) {
    return { inserted: 0, updated: 0, deleted: deletedCount };
  }

  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    const stmt = db.prepare(`
      INSERT INTO apartments (
        id, title, type, city, neighborhood, address, price, rooms, floor,
        square_meters, description, url, images, contact_name, contact_phone,
        attributes, scraped_at, updated_at, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        type = excluded.type,
        city = excluded.city,
        neighborhood = excluded.neighborhood,
        address = CASE WHEN excluded.details IS NULL AND apartments.details IS NOT NULL THEN apartments.address ELSE excluded.address END,
        price = excluded.price,
        rooms = excluded.rooms,
        floor = CASE WHEN excluded.details IS NULL AND apartments.details IS NOT NULL THEN apartments.floor ELSE COALESCE(excluded.floor, apartments.floor) END,
        square_meters = COALESCE(excluded.square_meters, apartments.square_meters),
        description = COALESCE(excluded.description, apartments.description),
        url = excluded.url,
        images = excluded.images,
        contact_name = excluded.contact_name,
        contact_phone = excluded.contact_phone,
        attributes = CASE WHEN excluded.details IS NULL AND apartments.details IS NOT NULL THEN apartments.attributes ELSE excluded.attributes END,
        details = COALESCE(excluded.details, apartments.details),
        updated_at = excluded.updated_at
      WHERE julianday(excluded.updated_at) >= julianday(apartments.updated_at);
    `).bind(
      item.id,
      item.title,
      item.type,
      item.city,
      item.neighborhood || null,
      item.address || null,
      item.price,
      item.rooms,
      item.floor ?? null,
      item.square_meters ?? null,
      item.description || null,
      item.url,
      JSON.stringify(item.images || []),
      item.contact_name || null,
      item.contact_phone || null,
      JSON.stringify(item.attributes || {}),
      item.scraped_at,
      item.updated_at,
      item.details ? JSON.stringify(item.details) : null
    );
    statements.push(stmt);
  }

  // D1 batch execution (up to 100 statements per batch)
  const batchSize = 50;
  let totalProcessed = 0;
  for (let i = 0; i < statements.length; i += batchSize) {
    const chunk = statements.slice(i, i + batchSize);
    await db.batch(chunk);
    totalProcessed += chunk.length;
  }

  return { inserted: totalProcessed, updated: totalProcessed };
}

export async function searchApartments(db: D1Database, filters: SearchFilters): Promise<{ results: Apartment[]; total: number }> {
  let whereClauses: string[] = ['1=1'];
  const params: any[] = [];

  if (filters.type) {
    whereClauses.push('type = ?');
    params.push(filters.type);
  }

  if (filters.city) {
    whereClauses.push('city = ?');
    params.push(normalizeCity(filters.city));
  }

  if (filters.neighborhood) {
    whereClauses.push('neighborhood LIKE ?');
    params.push(`%${filters.neighborhood}%`);
  }

  if (filters.street) {
    whereClauses.push('address LIKE ?');
    params.push(`%${filters.street}%`);
  }

  if (filters.query) {
    whereClauses.push('(title LIKE ? OR address LIKE ? OR neighborhood LIKE ? OR description LIKE ?)');
    const q = `%${filters.query}%`;
    params.push(q, q, q, q);
  }

  if (filters.min_price !== undefined) {
    whereClauses.push('price >= ?');
    params.push(filters.min_price);
  }

  if (filters.max_price !== undefined) {
    whereClauses.push('price <= ?');
    params.push(filters.max_price);
  }

  if (filters.min_rooms !== undefined) {
    whereClauses.push('rooms >= ?');
    params.push(filters.min_rooms);
  }

  if (filters.max_rooms !== undefined) {
    whereClauses.push('rooms <= ?');
    params.push(filters.max_rooms);
  }

  if (filters.min_sqm !== undefined) {
    whereClauses.push('square_meters >= ?');
    params.push(filters.min_sqm);
  }

  if (filters.max_sqm !== undefined) {
    whereClauses.push('square_meters <= ?');
    params.push(filters.max_sqm);
  }

  const featureFilters: [keyof SearchFilters, string][] = [
    ['has_elevator', 'elevator'], ['has_parking', 'parking'], ['has_mamad', 'mamad'],
    ['has_balcony', 'balcony'], ['has_storage', 'storage'],
    ['has_registered_parking', 'parking_registered'], ['has_sun_terrace', 'sun_terrace'],
  ];
  for (const [filter, attribute] of featureFilters) {
    if (filters[filter] !== undefined) {
      const value = `json_extract(attributes, '$.${attribute}')`;
      whereClauses.push(filters.include_unknown ? `(${value} = ? OR ${value} IS NULL)` : `${value} = ?`);
      params.push(filters[filter] ? 1 : 0);
    }
  }
  for (const [filter, expression, comparison] of [
    ['min_floor', 'floor', '>='], ['max_floor', 'floor', '<='],
  ] as const) {
    if (filters[filter] !== undefined) {
      whereClauses.push(filters.include_unknown ? `(${expression} ${comparison} ? OR ${expression} IS NULL)` : `${expression} ${comparison} ?`);
      params.push(filters[filter]);
    }
  }
  if (filters.max_building_age !== undefined) {
    const age = "CAST(strftime('%Y','now') AS INTEGER) - json_extract(details, '$.building_year')";
    whereClauses.push(filters.include_unknown ? `((${age} BETWEEN 0 AND ?) OR ${age} IS NULL)` : `${age} BETWEEN 0 AND ?`);
    params.push(filters.max_building_age);
  }
  if (filters.exclude_renewal) {
    const kind = "json_extract(details, '$.building_kind')";
    whereClauses.push(filters.include_unknown ? `(${kind} IS NULL OR ${kind} != 'renewal')` : `${kind} = 'new_building'`);
  }

  const limit = Math.min(filters.limit || 20, 100);
  const offset = filters.offset || 0;

  const whereSql = whereClauses.join(' AND ');

  // Count total query
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM apartments WHERE ${whereSql}`).bind(...params);
  const countResult = await countStmt.first<{ count: number }>();
  const total = countResult?.count || 0;

  // Data query
  const dataStmt = db.prepare(
    `SELECT * FROM apartments WHERE ${whereSql} ORDER BY ${filters.sort_by === 'floor_desc' ? 'floor DESC, price ASC' : filters.sort_by === 'price_asc' ? 'price ASC' : 'updated_at DESC'}, id ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset);

  const { results: rawRows } = await dataStmt.all();

  const results: Apartment[] = (rawRows || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    city: row.city,
    neighborhood: row.neighborhood || undefined,
    address: row.address || undefined,
    price: row.price,
    rooms: row.rooms,
    floor: row.floor !== null ? row.floor : undefined,
    square_meters: row.square_meters !== null ? row.square_meters : undefined,
    description: row.description || undefined,
    url: row.url,
    images: row.images ? JSON.parse(row.images) : [],
    contact_name: row.contact_name || undefined,
    contact_phone: row.contact_phone || undefined,
    attributes: row.attributes ? JSON.parse(row.attributes) : {},
    details: row.details ? JSON.parse(row.details) : undefined,
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
  }));

  for (const apt of results) apt.possible_duplicate_ids = await possibleDuplicates(db, apt);
  return { results, total };
}

export function normalizeCity(city: string): string {
  const aliases: Record<string, string> = { holon: 'חולון', 'bat yam': 'בת ים', 'bat-yam': 'בת ים', azor: 'אזור' };
  return aliases[city.trim().toLowerCase()] || city.trim();
}

export async function getListingHistory(db: D1Database, id: string) {
  return (await db.prepare('SELECT * FROM listing_history WHERE apartment_id = ? ORDER BY id DESC LIMIT 100').bind(id).all()).results;
}

export async function getPriceDrops(db: D1Database, city?: string) {
  const stmt = city
    ? db.prepare("SELECT *, old_price - new_price AS drop_amount FROM listing_events WHERE kind = 'price_drop' AND city = ? ORDER BY id DESC LIMIT 100").bind(normalizeCity(city))
    : db.prepare("SELECT *, old_price - new_price AS drop_amount FROM listing_events WHERE kind = 'price_drop' ORDER BY id DESC LIMIT 100");
  return (await stmt.all()).results;
}

export async function getApartmentById(db: D1Database, id: string): Promise<Apartment | null> {
  const stmt = db.prepare('SELECT * FROM apartments WHERE id = ?').bind(id);
  const row = await stmt.first<any>();

  if (!row) return null;

  const apartment: Apartment = {
    id: row.id,
    title: row.title,
    type: row.type,
    city: row.city,
    neighborhood: row.neighborhood || undefined,
    address: row.address || undefined,
    price: row.price,
    rooms: row.rooms,
    floor: row.floor !== null ? row.floor : undefined,
    square_meters: row.square_meters !== null ? row.square_meters : undefined,
    description: row.description || undefined,
    url: row.url,
    images: row.images ? JSON.parse(row.images) : [],
    contact_name: row.contact_name || undefined,
    contact_phone: row.contact_phone || undefined,
    attributes: row.attributes ? JSON.parse(row.attributes) : {},
    details: row.details ? JSON.parse(row.details) : undefined,
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
  };
  apartment.possible_duplicate_ids = await possibleDuplicates(db, apartment);
  return apartment;
}

async function possibleDuplicates(db: D1Database, apt: Apartment): Promise<string[]> {
  if (!apt.address || apt.floor == null || !apt.details?.built_sqm || !apt.price) return [];
  const matches = await db.prepare(`SELECT id FROM apartments WHERE id != ? AND city = ? AND address = ?
    AND rooms = ? AND floor = ? AND price BETWEEN ? AND ?
    AND ABS(json_extract(details, '$.built_sqm') - ?) <= 5 LIMIT 10`)
    .bind(apt.id, apt.city, apt.address, apt.rooms, apt.floor, apt.price * .9, apt.price * 1.1, apt.details.built_sqm).all<{ id: string }>();
  return matches.results.map(row => row.id);
}

export async function getDetailQueue(db: D1Database, limit: number) {
  const rows = (await db.prepare(`SELECT * FROM apartments
    WHERE details IS NULL OR julianday(json_extract(details, '$.checked_at')) < julianday('now','-7 days')
    ORDER BY CASE WHEN type = 'sale' AND city = 'חולון' AND rooms = 3 AND price > 0 AND price <= 2800000
      AND (floor >= 6 OR floor IS NULL) THEN 0 ELSE 1 END,
      CASE WHEN details IS NULL THEN 0 ELSE 1 END,
      json_extract(details, '$.checked_at') ASC, floor DESC, updated_at DESC, id ASC LIMIT ?`)
    .bind(limit).all<any>()).results;
  return rows.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [],
    attributes: row.attributes ? JSON.parse(row.attributes) : {}, details: row.details ? JSON.parse(row.details) : undefined }));
}

export async function logScrape(db: D1Database, log: { status: string; rent_count: number; sale_count: number; message?: string }): Promise<void> {
  const stmt = db.prepare(
    'INSERT INTO scrape_logs (timestamp, status, rent_count, sale_count, message) VALUES (?, ?, ?, ?, ?)'
  ).bind(new Date().toISOString(), log.status, log.rent_count, log.sale_count, log.message || null);

  await stmt.run();
}

export async function getScrapeStats(db: D1Database): Promise<{
  total_listings: number;
  rent_listings: number;
  sale_listings: number;
  detail_enriched: number;
  last_scrape?: any;
}> {
  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM apartments').first<{ count: number }>();
  const rentStmt = db.prepare("SELECT COUNT(*) as count FROM apartments WHERE type = 'rent'").first<{ count: number }>();
  const saleStmt = db.prepare("SELECT COUNT(*) as count FROM apartments WHERE type = 'sale'").first<{ count: number }>();
  const lastLogStmt = db.prepare('SELECT * FROM scrape_logs ORDER BY id DESC LIMIT 1').first<any>();
  const detailStmt = db.prepare('SELECT COUNT(*) AS count FROM apartments WHERE details IS NOT NULL').first<{ count: number }>();

  const [totalRes, rentRes, saleRes, lastLog, detailRes] = await Promise.all([totalStmt, rentStmt, saleStmt, lastLogStmt, detailStmt]);

  return {
    total_listings: totalRes?.count || 0,
    rent_listings: rentRes?.count || 0,
    sale_listings: saleRes?.count || 0,
    detail_enriched: detailRes?.count || 0,
    last_scrape: lastLog || null,
  };
}
