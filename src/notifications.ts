import { Env } from './types';
import { normalizeCity } from './db/queries';

interface ListingEvent {
  id: number; kind: string; city: string; title: string; url: string;
  old_price: number | null; new_price: number;
}

// Events are stored in D1 with the listing write; delivery is independent of scraping.
export async function sendNotifications(env: Env, deliver: typeof fetch = fetch): Promise<void> {
  if (!env.RESEND_API_KEY || !env.NOTIFICATION_FROM || !env.NOTIFICATION_TO) return;
  const cities = (env.NOTIFICATION_CITIES || 'Holon,Bat Yam,Azor').split(',').map(normalizeCity).filter(Boolean);
  if (!cities.length) throw new Error('Notification cities must be configured');
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(`SELECT * FROM listing_events
    WHERE notified_at IS NULL AND (lease_until IS NULL OR lease_until < ?)
    AND city IN (${cities.map(() => '?').join(',')}) ORDER BY id LIMIT 10`).bind(now, ...cities).all<ListingEvent>();
  for (const event of results) {
    const token = crypto.randomUUID();
    const lease = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const claim = await env.DB.prepare(`UPDATE listing_events SET lease_until = ?, lease_token = ?
      WHERE id = ? AND notified_at IS NULL AND (lease_until IS NULL OR lease_until < ?)`)
      .bind(lease, token, event.id, now).run();
    if (!claim.meta.changes) continue;
    try {
      const response = await deliver('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
          'Idempotency-Key': `yad2-listing-event-${event.id}` },
        body: JSON.stringify({ from: env.NOTIFICATION_FROM, to: [env.NOTIFICATION_TO],
          subject: `Yad2 ${event.kind === 'price_drop' ? 'price drop' : 'new listing'} — ${event.city}`,
          text: `${event.title}\n${event.city}\n${event.old_price === null ? '' : `Previous price: ${event.old_price} ILS\n`}Price: ${event.new_price} ILS\n${event.url}` }),
      });
      if (!response.ok) throw new Error(`Email provider HTTP ${response.status}`);
      const receipt = await response.json() as { id?: string };
      if (!receipt.id) throw new Error('Email provider did not acknowledge delivery');
      await env.DB.prepare('UPDATE listing_events SET notified_at = ?, lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?')
        .bind(new Date().toISOString(), event.id, token).run();
    } catch {
      await env.DB.prepare('UPDATE listing_events SET lease_until = NULL, lease_token = NULL WHERE id = ? AND lease_token = ?')
        .bind(event.id, token).run();
      throw new Error(`Notification delivery failed for event ${event.id}; retained for retry`);
    }
  }
}
