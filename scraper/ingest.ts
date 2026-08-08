import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { ScrapedApartment } from './yad2-stealth';

dotenv.config();

export async function sendIngestData(
  items: ScrapedApartment[],
  log?: { status: string; rent_count: number; sale_count: number; message?: string },
  purgePrevious: boolean = true
) {
  const workerUrl = process.env.WORKER_URL || 'http://localhost:8787';
  const ingestSecret = process.env.INGEST_SECRET || 'dev_ingest_secret_key';

  const ingestEndpoint = `${workerUrl.replace(/\/$/, '')}/ingest`;
  console.log(`[Ingest] Posting ${items.length} items to ${ingestEndpoint} (purgePrevious=${purgePrevious})...`);

  try {
    const res = await fetch(ingestEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Secret': ingestSecret,
        Authorization: `Bearer ${ingestSecret}`,
      },
      body: JSON.stringify({
        items,
        purge_previous: purgePrevious,
        log,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ingest request failed with status ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    console.log('[Ingest] Ingestion successful:', data);
    return data;
  } catch (err: any) {
    console.error('[Ingest] Failed to transmit data to Cloudflare Worker:', err.message);
    throw err;
  }
}
