const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare } = require('miniflare');
let mf, db, notifications;

async function applySql(filename, target = db) {
  let sql = fs.readFileSync(filename, 'utf8').replace(/--[^\n]*/g, '');
  const triggers = [];
  sql = sql.replace(/CREATE TRIGGER[\s\S]*?END;/g, v => { triggers.push(v); return ''; });
  for (const statement of [...sql.split(';').filter(v => v.trim()), ...triggers]) {
    await target.prepare(statement).run();
  }
}
const item = (price = 6000, updated_at = '2026-10-12T10:00:00Z') => ({
  id: 'test-1', title: 'Apartment', city: 'חולון', type: 'rent', price, rooms: 3,
  url: 'https://www.yad2.co.il/item/test-1', images: [], attributes: {},
  address: null, floor: null, square_meters: null,
  scraped_at: updated_at, updated_at,
});
async function ingest(items, extra = {}, secret = 'test-only-secret') {
  return mf.dispatchFetch('http://localhost/ingest', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': secret },
    body: JSON.stringify({ items, ...extra }) });
}
before(async () => {
  fs.mkdirSync('.wrangler/tests', { recursive: true });
  await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', platform: 'browser',
    outfile: '.wrangler/tests/worker.mjs' });
  await build({ entryPoints: ['src/notifications.ts'], bundle: true, format: 'cjs', platform: 'node',
    outfile: '.wrangler/tests/notifications.cjs' });
  notifications = require(path.resolve('.wrangler/tests/notifications.cjs'));
  mf = new Miniflare({ modules: true, scriptPath: '.wrangler/tests/worker.mjs',
    compatibilityDate: '2024-10-22', d1Databases: ['DB', 'BASELINE'], bindings: { INGEST_SECRET: 'test-only-secret' } });
  db = await mf.getD1Database('DB');
  await applySql('schema.sql');
  await applySql('migrations/0001_history.sql');
  await applySql('migrations/0002_details.sql');
});
after(async () => { if (mf) await mf.dispose(); });

test('migration preserves existing listings and backfills history without old-inventory notifications', async () => {
  const legacy = await mf.getD1Database('BASELINE');
  await applySql('schema.sql', legacy);
  await legacy.prepare(`INSERT INTO apartments(id,title,type,city,price,rooms,url,scraped_at,updated_at)
    VALUES ('existing','Existing apartment','rent','חולון',6000,3,'https://www.yad2.co.il/item/existing','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`).run();
  await applySql('migrations/0001_history.sql', legacy);
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM apartments').first()).n, 1);
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM listing_history').first()).n, 1);
  assert.equal((await legacy.prepare('SELECT COUNT(*) AS n FROM listing_events').first()).n, 0);
});

test('auth and whole-payload validation prevent writes and purge', async () => {
  assert.equal((await ingest([], {}, '')).status, 401);
  assert.equal((await ingest([item()], { purge_previous: true })).status, 400);
  assert.equal((await ingest([item(), { ...item(), price: 'bad' }])).status, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM apartments').first()).n, 0);
});
test('history and price drops survive retries, price increases and stale scrapes', async () => {
  assert.equal((await ingest([item()])).status, 200);
  assert.equal((await ingest([item()])).status, 200);
  assert.equal((await ingest([item(5500, '2026-10-12T11:00:00Z')])).status, 200);
  assert.equal((await ingest([item(5500, '2026-10-12T11:00:00Z')])).status, 200);
  await ingest([item(7000, '2026-10-12T12:00:00Z')]);
  await ingest([item(4000, '2026-10-12T09:00:00Z')]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM listing_history').first()).n, 3);
  const events = (await db.prepare('SELECT * FROM listing_events ORDER BY id').all()).results;
  assert.deepEqual(events.map(e => e.kind), ['new_listing', 'price_drop']);
  assert.equal(events[1].old_price, 6000);
  assert.equal(events[1].new_price, 5500);
  assert.equal((await db.prepare('SELECT price FROM apartments').first()).price, 7000);
  await applySql('migrations/0001_history.sql');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM listing_history').first()).n, 3);
});
test('English city searches match exact Hebrew cities and expose history', async () => {
  const rpc = async (name, args) => (await (await mf.dispatchFetch('http://localhost/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })).json()).result;
  const result = JSON.parse((await rpc('search_apartments', { city: 'Holon' })).content[0].text);
  assert.equal(result.total, 1);
  assert.equal(JSON.parse((await rpc('search_apartments', { city: 'Bat Yam' })).content[0].text).total, 0);
  assert.equal(JSON.parse((await rpc('get_price_drops', { city: 'Holon' })).content[0].text)[0].drop_amount, 500);
  assert.equal(JSON.parse((await rpc('get_listing_history', { id: 'test-1' })).content[0].text).length, 3);
});

test('official MCP client initializes, discovers read-only tools and queries D1 over Streamable HTTP', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (url, init) => mf.dispatchFetch(String(url), init),
  });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 5);
    assert.ok(list.tools.every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
    const result = await client.callTool({ name: 'search_apartments', arguments: { city: 'Holon', type: 'rent' } });
    assert.equal(JSON.parse(result.content[0].text).total, 1);
    await assert.rejects(client.callTool({ name: 'search_apartments', arguments: { limit: -1 } }), /Invalid tool arguments/);
    await assert.rejects(client.callTool({ name: 'unknown', arguments: {} }), /Unknown listing tool/);
  } finally { await client.close(); }
});

test('MCP notifications, protocol validation and stateless HTTP methods are handled correctly', async () => {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const notification = await mf.dispatchFetch('http://localhost/mcp', { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  const get = await mf.dispatchFetch('http://localhost/mcp', { headers: { Accept: 'text/event-stream' } });
  assert.equal(get.status, 405);
  const invalid = await mf.dispatchFetch('http://localhost/mcp', { method: 'POST',
    headers: { ...headers, 'Mcp-Protocol-Version': 'invalid' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(invalid.status, 400);
});
test('email failure stays queued; success marks sent; repeats send nothing; no secrets disable delivery', async () => {
  const env = { DB: db, RESEND_API_KEY: 'test-only-key', NOTIFICATION_FROM: 'test@example.com',
    NOTIFICATION_TO: 'recipient@example.com', NOTIFICATION_CITIES: 'Holon,Bat Yam,Azor' };
  let count = 0;
  const success = async (url, request) => {
    count++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.match(request.headers['Idempotency-Key'], /^yad2-listing-event-/);
    return new Response(JSON.stringify({ id: 'test-receipt' }), { status: 200 });
  };
  await notifications.sendNotifications({ DB: db }, success);
  assert.equal(count, 0);
  await assert.rejects(notifications.sendNotifications(env, async () => new Response('', { status: 503 })), /retained for retry/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM listing_events WHERE notified_at IS NULL').first()).n, 2);
  await notifications.sendNotifications(env, success);
  assert.equal(count, 2);
  await notifications.sendNotifications(env, success);
  assert.equal(count, 2);
});

test('detail filters, unknown candidates, floor sorting and duplicate hints work over MCP', async () => {
  const details = { checked_at: '2026-10-12T13:00:00Z', source_url: 'https://www.yad2.co.il/item/detail-a',
    building_year: 2025, building_kind: 'new_building', built_sqm: 65, evidence: { parking_registered: 'חניה בטאבו', sun_terrace: 'מרפסת שמש' } };
  const a = { ...item(2040000, '2026-10-12T13:00:00Z'), id: 'detail-a', type: 'sale', address: 'חסדאי',
    floor: 6, square_meters: 75, description: 'בניין בן שנה. חניה בטאבו ומרפסת שמש',
    attributes: { parking: true, parking_registered: true, elevator: true, sun_terrace: true, balcony: true, storage: null }, details };
  const b = { ...a, id: 'detail-b', price: 2080000, details: { ...details, built_sqm: 68 } };
  const unknown = { ...a, id: 'detail-unknown', address: 'ירמיהו 18', floor: 8,
    attributes: { parking: true, elevator: true, parking_registered: null, sun_terrace: null },
    details: { ...details, building_year: null, building_kind: 'unknown' } };
  const renewal = { ...a, id: 'detail-renewal', floor: 7, details: { ...details, building_year: null, building_kind: 'renewal' } };
  assert.equal((await ingest([a, b, unknown, renewal])).status, 200);
  const rpc = async (name, args) => JSON.parse((await (await mf.dispatchFetch('http://localhost/mcp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })).json()).result.content[0].text);
  const filters = { city: 'Holon', type: 'sale', min_rooms: 3, max_rooms: 3, max_price: 2700000,
    min_floor: 6, max_building_age: 15, exclude_renewal: true, has_registered_parking: true,
    has_sun_terrace: true, has_elevator: true, sort_by: 'floor_desc' };
  const strict = await rpc('search_apartments', filters);
  assert.deepEqual(strict.apartments.map(a => a.id), ['detail-a', 'detail-b']);
  assert.deepEqual(strict.apartments[0].possible_duplicate_ids, ['detail-b']);
  assert.equal(strict.apartments[0].match_status, 'matches_stored_claims');
  const candidates = await rpc('search_apartments', { ...filters, include_unknown: true });
  assert.equal(candidates.apartments[0].id, 'detail-unknown');
  assert.equal(candidates.apartments[0].match_status, 'needs_verification');
  assert.equal(candidates.total, 3); // Renewal is still excluded.
  const explicitNo = await rpc('search_apartments', { city: 'Holon', type: 'sale', has_sun_terrace: false });
  assert.equal(explicitNo.total, 0); // Unknown is not false.
  await ingest([{ ...a, updated_at: '2026-10-12T14:00:00Z', details: undefined,
    description: undefined, address: 'bad summary address', floor: null, attributes: { elevator: null } }]);
  const saved = await rpc('get_apartment_details', { id: 'detail-a' });
  assert.equal(saved.address, 'חסדאי'); assert.equal(saved.floor, 6);
  assert.equal(saved.attributes.elevator, true); assert.ok(saved.description);
  assert.deepEqual(saved.details, { ...details, checked_at: new Date(details.checked_at).toISOString() });
  assert.deepEqual(saved.possible_duplicate_ids, ['detail-b']);
});

test('detail queue is authenticated, bounded and skips recently enriched listings', async () => {
  assert.equal((await mf.dispatchFetch('http://localhost/detail-queue')).status, 401);
  const queue = await (await mf.dispatchFetch('http://localhost/detail-queue?limit=1', { headers: { 'X-Ingest-Secret': 'test-only-secret' } })).json();
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].id, 'test-1');
});
