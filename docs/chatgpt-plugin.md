# Connect the apartment monitor to ChatGPT

The Worker exposes a stateless MCP Streamable HTTP endpoint:

`https://yad2-mcp.gil202.workers.dev/mcp`

It supports MCP initialization, initialized notifications, tool discovery,
validated tool calls and JSON responses through the official MCP SDK. It
declines the optional GET event stream with HTTP 405. Each request uses a
fresh server/transport, so Cloudflare instances do not need shared sessions.

The five tools are read-only: `search_apartments`, `get_apartment_details`,
`get_listing_history`, `get_price_drops`, and `get_scraping_status`.
They cannot ingest listings, change the database, or send notifications.
No ingestion secret is needed or supplied to ChatGPT. The existing public
read endpoint uses **No authentication** for this personal plugin.

## Add the personal plugin

1. Open https://chatgpt.com/plugins on the web.
2. Select **Add** → **Add custom MCP server**.
3. Name it **Yad2 Apartment Monitor**.
4. Description: **Search and analyze monitored Yad2 listings in Holon, Bat Yam,
   and Azor, including listing history and price drops.**
5. Enter the endpoint above and select **No authentication**.
6. Review the custom-server notice and create the plugin.
7. Install it from your Personal directory. In a new conversation, type `@`
   and select **Yad2 Apartment Monitor**.

Account and workspace policies control whether custom servers are available.
Official instructions: https://developers.openai.com/plugins/deploy/connect-chatgpt.

Example prompt:

> Use Yad2 Apartment Monitor to compare 3-room rentals in Holon, Bat Yam,
> and Azor under ₪6,500. Include direct listing links, explain missing specs,
> and use observed price history when it exists.

The stored listings are sampled search-page cards, not complete city inventory.
A zero price or room count means unknown. Missing listings are retained, so
last observation is not a guarantee of current availability. History begins
when monitoring starts; it does not establish earlier market trends.

## Verification

`npm test` exercises the real MCP client handshake and D1 tool calls in an
isolated Worker, plus notifications, invalid parameters and protocol headers.
`npm run typecheck` checks the Worker source. Requests from a manual HTTP client
should include `Accept: application/json, text/event-stream` and
`Content-Type: application/json`.
