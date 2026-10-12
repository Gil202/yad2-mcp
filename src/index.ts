import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, IngestPayload } from './types';
import { upsertApartments, logScrape } from './db/queries';
import { TOOLS_MANIFEST, handleCallTool } from './mcp/tools';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

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
    const payload = (await c.req.json()) as IngestPayload;

    if (!payload.items || !Array.isArray(payload.items)) {
      return c.json({ error: 'Invalid payload: "items" array is required' }, 400);
    }

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

// Standard MCP HTTP JSON-RPC endpoint (for single-call MCP client requests)
app.post('/mcp', async (c) => {
  try {
    const body = await c.req.json();
    const { jsonrpc, id, method, params } = body;

    if (jsonrpc !== '2.0') {
      return c.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } }, 400);
    }

    if (method === 'initialize') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'yad2-mcp-server',
            version: '1.0.0',
          },
        },
      });
    }

    if (method === 'tools/list') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS_MANIFEST,
        },
      });
    }

    if (method === 'tools/call') {
      const { name, arguments: toolArgs } = params || {};
      const response = await handleCallTool(c.env.DB, name, toolArgs || {});
      return c.json({
        jsonrpc: '2.0',
        id,
        result: response,
      });
    }

    return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }, 404);
  } catch (err: any) {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } }, 500);
  }
});

// Standard MCP Server-Sent Events (SSE) endpoint
app.get('/sse', (c) => {
  return c.text('MCP SSE Endpoint Ready. Send JSON-RPC requests to POST /mcp');
});

export default app;
