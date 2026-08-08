import { Apartment, SearchFilters, Env } from '../types';

export async function purgeApartments(db: D1Database): Promise<{ deleted: number }> {
  const stmt = db.prepare('DELETE FROM apartments;');
  const res = await stmt.run();
  return { deleted: res.meta.changes || 0 };
}

export async function upsertApartments(
  db: D1Database,
  items: Apartment[],
  purgePrevious: boolean = false
): Promise<{ inserted: number; updated: number; deleted?: number }> {
  let deletedCount = 0;
  if (purgePrevious) {
    const purgeRes = await purgeApartments(db);
    deletedCount = purgeRes.deleted;
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
        attributes, scraped_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        type = excluded.type,
        city = excluded.city,
        neighborhood = excluded.neighborhood,
        address = excluded.address,
        price = excluded.price,
        rooms = excluded.rooms,
        floor = excluded.floor,
        square_meters = excluded.square_meters,
        description = excluded.description,
        url = excluded.url,
        images = excluded.images,
        contact_name = excluded.contact_name,
        contact_phone = excluded.contact_phone,
        attributes = excluded.attributes,
        updated_at = excluded.updated_at;
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
      item.updated_at
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
    whereClauses.push('city LIKE ?');
    params.push(`%${filters.city}%`);
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

  if (filters.has_elevator) {
    whereClauses.push(`json_extract(attributes, '$.elevator') = true`);
  }

  if (filters.has_parking) {
    whereClauses.push(`json_extract(attributes, '$.parking') = true`);
  }

  if (filters.has_mamad) {
    whereClauses.push(`json_extract(attributes, '$.mamad') = true`);
  }

  if (filters.has_balcony) {
    whereClauses.push(`json_extract(attributes, '$.balcony') = true`);
  }

  if (filters.has_storage) {
    whereClauses.push(`json_extract(attributes, '$.storage') = true`);
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
    `SELECT * FROM apartments WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
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
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
  }));

  return { results, total };
}

export async function getApartmentById(db: D1Database, id: string): Promise<Apartment | null> {
  const stmt = db.prepare('SELECT * FROM apartments WHERE id = ?').bind(id);
  const row = await stmt.first<any>();

  if (!row) return null;

  return {
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
    scraped_at: row.scraped_at,
    updated_at: row.updated_at,
  };
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
  last_scrape?: any;
}> {
  const totalStmt = db.prepare('SELECT COUNT(*) as count FROM apartments').first<{ count: number }>();
  const rentStmt = db.prepare("SELECT COUNT(*) as count FROM apartments WHERE type = 'rent'").first<{ count: number }>();
  const saleStmt = db.prepare("SELECT COUNT(*) as count FROM apartments WHERE type = 'sale'").first<{ count: number }>();
  const lastLogStmt = db.prepare('SELECT * FROM scrape_logs ORDER BY id DESC LIMIT 1').first<any>();

  const [totalRes, rentRes, saleRes, lastLog] = await Promise.all([totalStmt, rentStmt, saleStmt, lastLogStmt]);

  return {
    total_listings: totalRes?.count || 0,
    rent_listings: rentRes?.count || 0,
    sale_listings: saleRes?.count || 0,
    last_scrape: lastLog || null,
  };
}
