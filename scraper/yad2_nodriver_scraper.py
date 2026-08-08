import asyncio
import json
import os
import re
import tempfile
import datetime
import urllib.request
import urllib.parse
import nodriver as uc

WORKER_URL = os.getenv("WORKER_URL", "http://localhost:8787")
INGEST_SECRET = os.getenv("INGEST_SECRET", "dev_ingest_secret_key")

def parse_price(val):
    if not val:
        return 0.0
    val_str = str(val).replace(",", "").replace("₪", "").strip()
    match = re.search(r"[-+]?\d*\.\d+|\d+", val_str)
    return float(match.group()) if match else 0.0

def parse_number(val):
    if not val:
        return 0.0
    val_str = str(val).replace(",", "").strip()
    match = re.search(r"[-+]?\d*\.\d+|\d+", val_str)
    return float(match.group()) if match else 0.0

def extract_specs_from_lines(lines):
    rooms = 3.0
    floor = None
    sqm = None

    for line in lines:
        if not line or not isinstance(line, str):
            continue

        rooms_match = re.search(r"(\d+(?:\.\d+)?)\s*חדרים", line)
        if rooms_match:
            rooms = float(rooms_match.group(1))

        floor_match = re.search(r"קומה\s*(\d+)", line)
        if floor_match:
            floor = int(floor_match.group(1))

        sqm_match = re.search(r"(\d+(?:\.\d+)?)\s*מ\"ר", line)
        if sqm_match:
            sqm = float(sqm_match.group(1))

    return rooms, floor, sqm

def extract_attributes_from_lines_and_text(lines, text=""):
    combined = (text + " " + " ".join(lines)).lower()
    return {
        "mamad": any(kw in combined for kw in ["ממ\"ד", "ממד", "מרחב מוגן", "ממ״ד"]),
        "parking": any(kw in combined for kw in ["חניה", "חנייה", "חניה מקורה", "חניה פרטית"]),
        "storage": any(kw in combined for kw in ["מחסן", "מחסן פרטי", "מחסן צמוד"]),
        "elevator": "מעלית" in combined,
        "balcony": any(kw in combined for kw in ["מרפסת", "מרפסת שמש"]),
        "renovated": any(kw in combined for kw in ["משופצת", "משופץ", "משודרגת"]),
        "furniture": any(kw in combined for kw in ["מרוהטת", "מרוהט", "ריהוט"]),
        "air_conditioning": any(kw in combined for kw in ["מזגן", "מיזוג"]),
    }

async def scrape_category(browser, category_type):
    url = (
        "https://www.yad2.co.il/realestate/rent"
        if category_type == "rent"
        else "https://www.yad2.co.il/realestate/forsale"
    )
    print(f"[Scraper] Navigating to Yad2 ({category_type.upper()}): {url}")
    page = await browser.get(url)

    await asyncio.sleep(5)

    title = await page.evaluate("document.title")
    print(f"[Scraper] Page loaded. Title: '{title}'")

    if "Radware" in title or "Captcha" in title:
        print("[Scraper] Waiting for Radware / ShieldSquare challenge auto-redirect...")
        await asyncio.sleep(6)
        title = await page.evaluate("document.title")

    if "Radware" in title or "Captcha" in title:
        print(f"[Scraper] Warning: Radware block present for {category_type}")
        return []

    # Scroll down to ensure content & lazy images render
    await page.evaluate("window.scrollBy(0, 1000)")
    await asyncio.sleep(2)

    # Use JSON.stringify in page.evaluate so nodriver returns a clean JSON string
    json_str = await page.evaluate("""
        (() => {
            const links = Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.includes('/item/'));
            const seen = new Set();
            const items = [];

            links.forEach((a, idx) => {
                const href = a.href;
                if (seen.has(href)) return;
                seen.add(href);

                let card = a;
                for (let i = 0; i < 4; i++) {
                    if (card.parentElement) card = card.parentElement;
                }

                const text = card.innerText || '';
                const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);

                const priceMatch = text.match(/[\\d,]+\\s*₪/);
                const imgEl = card.querySelector('img');

                items.push({
                    id: href.split('?')[0].split('/').pop() || `item_${idx}`,
                    url: href,
                    city: lines[1] || 'ישראל',
                    address: lines[2] || '',
                    price: priceMatch ? priceMatch[0] : '0 ₪',
                    image: imgEl ? imgEl.src : '',
                    text: text,
                    lines: lines.slice(0, 8)
                });
            });

            return JSON.stringify(items);
        })()
    """)

    extracted_items = []
    try:
        extracted_items = json.loads(json_str) if json_str else []
    except Exception as e:
        print(f"[Scraper] JSON parse error: {e}")

    parsed_apartments = []
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if isinstance(extracted_items, list) and extracted_items:
        print(f"[Scraper] Successfully extracted {len(extracted_items)} items for {category_type.upper()}")

        for idx, item in enumerate(extracted_items):
            if not isinstance(item, dict):
                continue

            item_id = str(item.get("id") or f"{category_type}_{idx}")
            notice_url = item.get("url") or f"https://www.yad2.co.il/item/{item_id}"

            lines = item.get("lines", [])
            card_text = item.get("text", "")

            price_val = parse_price(item.get("price"))
            city_val = item.get("city") or "ישראל"
            address_val = item.get("address") or (lines[2] if len(lines) > 2 else None)

            rooms_val, floor_val, sqm_val = extract_specs_from_lines(lines)
            attributes = extract_attributes_from_lines_and_text(lines, card_text)

            img_url = item.get("image")
            images_list = [img_url] if img_url and img_url.startswith("http") else ["https://assets.yad2.co.il/yad2site/y2images/realestate.jpg"]

            type_hebrew = "להשכרה" if category_type == "rent" else "למכירה"
            title_text = f"דירה {type_hebrew} ב{city_val} - {price_val:,.0f} ₪" if price_val > 0 else f"דירה {type_hebrew} ב{city_val}"

            parsed_apartments.append({
                "id": item_id,
                "title": title_text,
                "type": category_type,
                "city": city_val,
                "address": address_val,
                "price": price_val,
                "rooms": rooms_val,
                "floor": floor_val,
                "square_meters": sqm_val,
                "url": notice_url,
                "images": images_list,
                "attributes": attributes,
                "scraped_at": now_iso,
                "updated_at": now_iso
            })

    return parsed_apartments

def send_ingest_payload(items, rent_count, sale_count):
    endpoint = f"{WORKER_URL.rstrip('/')}/ingest"
    print(f"\n[Ingest] Transmitting {len(items)} listings to Cloudflare Worker ({endpoint})...")

    payload = {
        "items": items,
        "purge_previous": True,
        "log": {
            "status": "success",
            "rent_count": rent_count,
            "sale_count": sale_count,
            "message": f"Successfully scraped and ingested {len(items)} Yad2 listings"
        }
    }

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Ingest-Secret": INGEST_SECRET,
            "Authorization": f"Bearer {INGEST_SECRET}"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            resp_data = resp.read().decode("utf-8")
            print("[Ingest] Response:", resp_data)
            return json.loads(resp_data)
    except Exception as e:
        print("[Ingest] Note: Ingestion skipped/offline:", e)
        return None

async def main():
    print("[Scraper] Starting Yad2 Stealth Scraper (nodriver Chrome engine)...")
    
    config = uc.Config(sandbox=False)
    if os.path.exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        config.browser_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    config.user_data_dir = tempfile.mkdtemp()

    browser = await uc.start(config=config, headless=False)

    try:
        rent_items = await scrape_category(browser, "rent")
        print(f"[Scraper] Successfully scraped {len(rent_items)} rent apartments")

        await asyncio.sleep(3)

        sale_items = await scrape_category(browser, "sale")
        print(f"[Scraper] Successfully scraped {len(sale_items)} sale apartments")

        all_items = rent_items + sale_items
        print(f"\n==========================================")
        print(f"SCRAPE RUN SUMMARY: Total Listings Scraped: {len(all_items)}")
        print(f"Rent Listings: {len(rent_items)} | Sale Listings: {len(sale_items)}")
        print(f"==========================================")

        if all_items:
            print("\nSample Scraped Record with Attributes 1:")
            print(json.dumps(all_items[0], ensure_ascii=False, indent=2))
            if len(all_items) > 1:
                print("\nSample Scraped Record with Attributes 2:")
                print(json.dumps(all_items[1], ensure_ascii=False, indent=2))

            send_ingest_payload(all_items, len(rent_items), len(sale_items))
        else:
            print("[Scraper] Warning: 0 listings scraped.")

    finally:
        browser.stop()
        print("[Scraper] Browser session closed.")

if __name__ == "__main__":
    uc.loop().run_until_complete(main())
