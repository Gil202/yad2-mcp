import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { ScrapedApartment } from './yad2-stealth';

dotenv.config();

export async function sendIngestData(
  items: ScrapedApartment[],
  log?: { status: string; rent_count: number; sale_count: number; message?: string },
  purgePrevious: boolean = false
) {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:8787';
  const ingestSecret = process.env.INGEST_SECRET;
  if (!ingestSecret) throw new Error('INGEST_SECRET must be set');
  const url = new URL(workerUrl);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('WORKER_URL requires HTTPS without embedded credentials (except localhost)');
  }

  const ingestEndpoint = `${workerUrl.replace(/\/$/, '')}/ingest`;
  console.log(`[Ingest] Posting ${items.length} items to ${ingestEndpoint} (purgePrevious=${purgePrevious})...`);

  try {
    const res = await fetch(ingestEndpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': ingestSecret,
        'User-Agent': 'yad2-monitor/1.0',
      },
      body: JSON.stringify({
        items,
        purge_previous: purgePrevious,
        log,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ingest request failed with status ${res.status}`);
    }

    const data = (await res.json()) as any;
    if (data.success !== true) throw new Error('Worker did not acknowledge successful ingestion');
    console.log(`[Ingest] Accepted ${data.received} listings`);
    return data;
  } catch (err: any) {
    console.error('[Ingest] Failed to transmit data to Cloudflare Worker:', err.message);
    throw err;
  }
}
