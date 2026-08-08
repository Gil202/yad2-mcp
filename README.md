# Yad2 Real Estate Scraper & Cloudflare Worker MCP Server 🏠🤖

An open-source, 100% free solution for scraping Yad2 real estate listings (apartments for **rent** and **sale**) and serving them through an **MCP (Model Context Protocol)** server hosted on **Cloudflare Workers**.

Designed for AI agents (Claude Desktop, Cursor, Gemini, ChatGPT Actions) to search, filter, and inspect apartments with direct links to original Yad2 notices.

---

## ⚡ Architecture & Bot Protection Strategy

```
┌───────────────────────────────────────┐
│        GitHub Actions (Weekly)        │
│  - Playwright Stealth + Chromium      │  ──(POST /ingest)──┐
│  - Evades Radware / ShieldSquare      │                    │
└───────────────────────────────────────┘                    ▼
                                              ┌──────────────────────────────┐
                                              │      Cloudflare Worker       │
                                              │                              │
┌───────────────────────────────────────┐     │  ┌────────────────────────┐  │
│        AI Agent / MCP Client          │ <==>│  │  MCP Server (JSON-RPC) │  │
│   (Claude, Cursor, Custom Agents)     │     │  └───────────┬────────────┘  │
└───────────────────────────────────────┘     │              │               │
                                              │              ▼               │
                                              │  ┌────────────────────────┐  │
                                              │  │ Cloudflare D1 Database │  │
                                              │  └────────────────────────┘  │
                                              └──────────────────────────────┘
```

1. **Anti-Bot Bypass**: Direct scraper requests from cloud datacenter IPs (like Cloudflare Workers) are blocked by Yad2's Radware / ShieldSquare protection. To overcome this on a **100% free tier**, scraping is decoupled into a **weekly GitHub Actions workflow** using **`nodriver` + `xvfb-run` (Virtual Framebuffer)**, which runs a real Chrome headful browser inside memory to bypass Radware JS challenges (`stormcasterv2.js`).
2. **Edge Database (D1)**: Scraped listings are ingested into Cloudflare D1 (SQLite at the edge), providing sub-10ms lookup times and zero downtime.
3. **MCP Server**: Exposes MCP tools so AI agents can query apartments effortlessly.

---

## 🛠️ MCP Tools Offered

| Tool | Description |
| :--- | :--- |
| `search_apartments` | Search apartments for rent or sale by **city**, **neighborhood**, **street name**, free text `query`, price range, room counts, square meters, and amenities. Returns listings with direct Yad2 links (`url`). |
| `get_apartment_details` | Get full details for a listing by ID, including images, full description, contact details, and direct Yad2 notice link. |
| `get_scraping_status` | View database stats (total counts for rent/sale) and the timestamp of the last weekly scrape run. |

---

## 📊 Storage & Capacity Evaluation (Cloudflare D1 Free Tier)

| Metric | Cloudflare D1 Free Tier Limit | Space Consumed by Yad2 Scraper | % of Free Quota Used |
| :--- | :--- | :--- | :--- |
| **Storage Capacity** | **5 GB** (5,000,000 KB) | ~1.2 KB per apartment record (~12 MB for 10,000 listings) | **0.24%** |
| **Daily Writes** | **100,000 writes / day** | ~1,000 - 10,000 batch upserts once a week | **< 10%** (on scrape day) |
| **Daily Reads** | **5,000,000 reads / day** | ~10 - 100 queries / day by your AI agent | **< 0.002%** |

> 💡 **Conclusion**: Storing 10,000 to 50,000 active apartment listings uses **less than 1% to 1.2% of Cloudflare's free storage quota**. It is 100% free and virtually impossible to exceed the tier limit for personal or community use!

---

## 🚀 Quick Setup & Deployment Guide

### Prerequisites
- Node.js 18+ and `npm`
- Free [Cloudflare Account](https://dash.cloudflare.com)
- Free [GitHub Account](https://github.com)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/yad2-mcp.git
cd yad2-mcp

# Install root dependencies
npm install

# Install scraper dependencies
cd scraper && npm install && cd ..
```

### 2. Create Cloudflare D1 Database
Log into Cloudflare via Wrangler and create your D1 SQLite database:
```bash
npx wrangler login
npx wrangler d1 create yad2-db
```

Copy the generated `database_id` from the output into your `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "yad2-db"
database_id = "<YOUR_D1_DATABASE_ID>"
```

Initialize the database schema:
```bash
npm run d1:init:remote
```

### 3. Deploy Cloudflare Worker & Set Secret
Set an ingestion secret to secure the scraper upload endpoint:
```bash
npx wrangler secret put INGEST_SECRET
# Enter a secure key (e.g. my_super_secret_token_123)
```

Deploy the worker:
```bash
npm run deploy
```
Take note of your deployed Worker URL (e.g. `https://yad2-mcp.<your-subdomain>.workers.dev`).

---

## 📅 Setting Up Automated Scraper (GitHub Actions - Daily)

In your GitHub Repository, go to **Settings > Secrets and variables > Actions** and add two secrets:

1. `WORKER_URL`: `https://yad2-mcp.<your-subdomain>.workers.dev`
2. `INGEST_SECRET`: `my_super_secret_token_123` (matching the Wrangler secret set above)

The GitHub Actions workflow (`.github/workflows/scrape.yml`) will automatically run **every day at 02:00 UTC** (`0 2 * * *`). You can also click **Run workflow** manually anytime in the GitHub Actions tab!

---

## 💻 Local Testing & Development

### 1. Test Cloudflare Worker Locally
```bash
# Initialize local D1 database
npm run d1:init:local

# Start Wrangler local dev server
npm run dev
# Worker runs at http://localhost:8787
```

### 2. Run Local Scraper Test
In another terminal:
```bash
cd scraper
WORKER_URL=http://localhost:8787 INGEST_SECRET=dev_ingest_secret_key npm run scrape
```

---

## 🤖 Connecting to AI Agents

### Claude Desktop / Cursor Setup
Add the following to your `claude_desktop_config.json` or Cursor MCP settings:

```json
{
  "mcpServers": {
    "yad2-apartments": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-fetch",
        "https://yad2-mcp.<your-subdomain>.workers.dev/mcp"
      ]
    }
  }
}
```

Or configure custom SSE connection directly to:
```
https://yad2-mcp.<your-subdomain>.workers.dev/mcp
```

---

## ⚠️ Disclaimer & Terms of Use

> **IMPORTANT**: This project is strictly for **educational, research, and technical evaluation purposes only**. It is designed to demonstrate building Model Context Protocol (MCP) servers on Cloudflare Workers and integration with web automation workflows.
>
> This tool **should NOT be used for scraping Yad2** or any unauthorized automated data extraction in violation of Yad2's Terms of Service, Robots.txt, or applicable local data laws. The authors and contributors bear no responsibility for any misuse of this software.

---

## 📄 License
MIT License. Open source & free for community use!
