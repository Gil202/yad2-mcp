import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { upsertApartments, logScrape, getDetailQueue } from './db/queries';
import { handleMcpRequest } from './mcp/server';
import { ingestSchema } from './validation';
import { sendNotifications } from './notifications';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ allowHeaders: ['Content-Type', 'Authorization', 'X-Ingest-Secret', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
  exposeHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'] }));

// Health & Info route
app.get('/health', async (c) => {
  try {
    const db = c.env.DB;
    const stmt = await db.prepare('SELECT COUNT(*) as count FROM apartments').first<{ count: number }>();
    return c.json({
      status: 'ok',
      service: 'yad2-mcp-server',
      database: 'connected',
      total_apartments: stmt?.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ status: 'error', message: err.message }, 500);
  }
});

// Secure Ingestion endpoint for scraper (GitHub Actions)
app.post('/ingest', async (c) => {
  const secretHeader = c.req.header('X-Ingest-Secret') || c.req.header('Authorization')?.replace('Bearer ', '');
  const expectedSecret = c.env.INGEST_SECRET;

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return c.json({ error: 'Unauthorized: Invalid ingestion secret' }, 401);
  }

  try {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid ingestion payload', issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
    const payload = parsed.data;

    const purgePrevious = Boolean(payload.purge_previous);
    const { inserted, updated, deleted } = await upsertApartments(c.env.DB, payload.items, purgePrevious);

    if (payload.log) {
      await logScrape(c.env.DB, payload.log);
    } else {
      const rentCount = payload.items.filter((item) => item.type === 'rent').length;
      const saleCount = payload.items.filter((item) => item.type === 'sale').length;
      await logScrape(c.env.DB, {
        status: 'success',
        rent_count: rentCount,
        sale_count: saleCount,
        message: `Ingested ${payload.items.length} listings${purgePrevious ? ` (purged ${deleted} old records)` : ''}`,
      });
    }

    return c.json({
      success: true,
      received: payload.items.length,
      processed: inserted,
      purged_old: deleted || 0,
      message: `Ingested ${payload.items.length} apartments into Cloudflare D1${purgePrevious ? ` after purging ${deleted} old listings` : ''}`,
    });
  } catch (err: any) {
    return c.json({ error: 'Ingestion failed', message: err.message }, 500);
  }
});

// Scraper-only backlog; never exposes ingestion credentials through MCP.
app.get('/detail-queue', async (c) => {
  if (!c.env.INGEST_SECRET || c.req.header('X-Ingest-Secret') !== c.env.INGEST_SECRET) return c.json({ error: 'Unauthorized' }, 401);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 300));
  return c.json({ items: await getDetailQueue(c.env.DB, Math.floor(limit)) });
});

app.all('/mcp', c => handleMcpRequest(c.req.raw as unknown as Request, c.env.DB));

export default {
  fetch: app.fetch,
  scheduled: (_controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(sendNotifications(env));
  },
};
