# Apartment monitor setup

## Diagnosis and ingestion fix

On 2026-10-12, an unauthenticated POST from Python urllib with its default
User-Agent returned HTTP 403 and `error code: 1010`. The same request with
`User-Agent: yad2-monitor/1.0` returned the Worker's expected HTTP 401 JSON.
Node also received 401; `/health` reported a connected, empty D1 database.
This reproduced an edge browser-signature block before Worker authentication,
not a D1 permission failure. Cloudflare documents the error at
https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/.

The Python transport now sets an explicit application User-Agent, requires
configured credentials, forbids credential-bearing redirects, times out, and
raises on failed ingestion. Actions can no longer report success after an
HTTP error. Error logs omit response bodies, secrets and redirect locations.
Optional `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` support an Access
service-token policy if one is added later; they are not needed for the
reproduced 1010 issue.

## History and search behavior

Apply `schema.sql` for a fresh database, then the additive migration
`migrations/0001_history.sql`. Existing databases only need the migration.
It preserves existing apartments and creates a baseline without notifying
about existing inventory. SQL triggers record changes to price, title, city,
transaction type and URL, and enqueue new-listing and price-drop events
atomically with the listing write. Historical prices are retained even when
an apartment is subsequently updated. Unknown/zero prices do not produce
price-drop events. Identical retries produce no duplicate history/events;
older observations cannot overwrite newer ones. Batches may partially complete
if a later batch fails; replaying the payload safely finishes the upload.

`scraped_at` retains the first observation; `updated_at` tracks the latest
accepted observation. Missing listings are retained: a partial search scrape
is not evidence that a listing was removed. `purge_previous: true` is rejected.
History currently covers the core fields above, not full contact/amenity snapshots.
The price parser excludes advertised drop amounts and accepts the currency
symbol before or after the actual price. Unknown room counts are stored as zero.

MCP tools include `get_listing_history` (ID, latest 100 changes) and
`get_price_drops` (optional city, latest 100 events). `search_apartments` uses
exact city matching and accepts Hebrew names or Holon, Bat Yam and Azor.

`scraper/searches.json` configures rent and sale searches for Holon (6600),
Bat Yam (6200), and Azor (0565). The zero-padded Azor parameter needs live
verification; the unpadded parameter fell back to an unfiltered page.
Azor's numeric code is the official locality code:
https://www.cbs.gov.il/he/publications/doclib/2022/local_authorities20_1879/425_0565.pdf.
Its Yad2 query still needs confirmation in a live scraper run. Cards must have
a matching city location line; recommendations from other cities are excluded.
Only the loaded search-page cards are monitored; this is not complete city
inventory or a paginated crawl. No room/price criteria are configured yet.

Override searches with the GitHub Actions **variable** `YAD2_SEARCHES` containing
a JSON array of `{ "city": "חולון", "type": "rent", "url": "https://www.yad2.co.il/realestate/rent?city=6600" }`
objects. Leave it unset to use the checked-in three-city configuration.
Keep `WORKER_URL` and `INGEST_SECRET` in Actions secrets; the ingestion secret
must match the existing Worker secret. Never paste secrets into source or logs.

## Scheduled email

The Worker polls pending events hourly (`0 * * * *`, UTC) and sends up to ten
emails per invocation through Resend. The scraper remains daily at 02:00 UTC.
Notifications include a new listing or a positive price decrease and a direct
Yad2 link, limited by `NOTIFICATION_CITIES` (default Holon,Bat Yam,Azor).
Delivery remains disabled until all three settings are present:

- `RESEND_API_KEY`: Worker secret for the email provider.
- `NOTIFICATION_FROM`: sender address permitted by the provider; configure
  a verified sending domain or a provider-authorized test sender.
- `NOTIFICATION_TO`: your destination email address.

Set these using interactive `wrangler secret put NAME`; do not put secret
values in command arguments or commit them. Your requested destination is
kept out of the checked-in configuration. A Gmail recipient works without
giving the Worker access to your Gmail account.

Each event has a lease to prevent concurrent sends, a provider idempotency key,
and a sent timestamp. Provider failures remain queued and fail the scheduled
invocation for visibility. Resend acceptance is not proof of inbox delivery.
There is a small duplicate-delivery window if the provider accepts an email
but saving the sent timestamp fails and retries occur beyond the provider's
idempotency retention period. No emails are sent by the tests.

Provider reference: https://resend.com/docs/api-reference/emails/send-email.

## Local checks

```sh
python -m unittest discover -s scraper -p 'test_monitor_*.py'
npm run typecheck
npm test
```

Worker tests use Miniflare's isolated SQLite/D1 database and mock email sends.
The included `scripts/probe_ingest.py` compares unauthenticated live requests
without loading credentials or writing listings.

## Publication and deployment sequence

These actions affect GitHub or production and have not been executed as part
of the local implementation:

1. Review and publish the repository changes. Preserve the pre-existing changes
   to `package-lock.json` and `scraper/test-headful.ts` when staging.
2. Apply the additive remote migration: `npm run d1:migrate:remote`.
   It creates history/event tables and triggers and does not delete listings.
   Apply it before deploying the new Worker to avoid missing-table errors.
3. Deploy: `npm run deploy`. This replaces Worker code and adds the hourly cron.
   Existing ingestion credentials remain in place; email remains disabled
   until the provider/sender/destination secrets are configured.
4. Run the Actions scraper manually. Confirm the upload step succeeds and
   `/health` shows listings. Check city searches, particularly Azor, against
   the loaded Yad2 page. Do not loosen the city check to relabel recommendations.
5. Configure email secrets after choosing a sender/provider account. Verify a
   scheduled delivery and provider logs without displaying credential values.

Do not execute purge/delete/reset operations to fix ingestion.
