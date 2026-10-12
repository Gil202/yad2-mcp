import asyncio
import json
import os
import re
import shutil
import tempfile
import datetime
import nodriver as uc
from ingest_http import ingest_config, send_payload
from search_config import load_searches, card_matches_city, card_price, listing_page_ready

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
    rooms = 0.0
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

async def wait_for_yad2_listings(page, category_type, max_wait_seconds=40):
    """
    Waits for Yad2 security challenge (אבטחת אתר / Radware / ShieldSquare)
    to execute client-side JS proof-of-work calculations and auto-redirect to the listings.
    """
    print(f"[Scraper] Waiting for {category_type.upper()} page and security challenge resolution (up to {max_wait_seconds}s)...")
    for second in range(1, max_wait_seconds + 1):
        await asyncio.sleep(1)

        # Micro-scrolling to simulate real human activity and trigger JS events
        if second % 3 == 0:
            try:
                await page.evaluate("window.scrollBy(0, 20); setTimeout(() => window.scrollBy(0, -20), 200);")
            except Exception:
                pass

        try:
            status_json = await page.evaluate("""
                (() => {
                    const title = document.title || '';
                    const items = document.querySelectorAll('a[href*="/item/"]').length;
                    const isSecurity = title.includes('אבטחת אתר') || 
                                       title.includes('Radware') || 
                                       title.includes('ShieldSquare') || 
                                       title.includes('Captcha') || 
                                       title.includes('Just a moment') ||
                                       title.includes('Attention Required') ||
                                       title.includes('Robot Check');
                    return JSON.stringify({
                        title: title,
                        itemsCount: items,
                        isSecurity: isSecurity
                    });
                })()
            """)
            status = json.loads(status_json)

            title = status.get("title", "")
            items_count = status.get("itemsCount", 0)
            is_security = status.get("isSecurity", False)

            if listing_page_ready(title, items_count, is_security):
                print(f"[Scraper] Challenge cleared at {second}s! Active Page Title: '{title}', Visible listings: {items_count}")
                return True
            else:
                if second % 5 == 0 or second == 1:
                    print(f"[Scraper] [{second}s/{max_wait_seconds}s] Security challenge in progress... Page Title: '{title}'")
        except Exception as e:
            if second % 5 == 0:
                print(f"[Scraper] [{second}s] Polling page status: {e}")

    try:
        final_title = await page.evaluate("document.title")
        print(f"[Scraper] Warning: Challenge did not clear within {max_wait_seconds}s. Final Title: '{final_title}'")
    except Exception:
        pass
    return False

async def scrape_category(browser, category_type, search=None):
    url = search["url"] if search else (
        "https://www.yad2.co.il/realestate/rent"
        if category_type == "rent"
        else "https://www.yad2.co.il/realestate/forsale"
    )
    print(f"[Scraper] Navigating to Yad2 ({category_type.upper()}): {url}")
    page = await browser.get(url)

    # Wait for the Radware/ShieldSquare security challenge to compute and redirect
    if not await wait_for_yad2_listings(page, category_type, max_wait_seconds=40):
        raise RuntimeError("Yad2 page was not ready; refusing to record a successful scrape")

    # Scroll down progressively to ensure all lazy-loaded cards and images render
    for _ in range(3):
        await page.evaluate("window.scrollBy(0, 800)")
        await asyncio.sleep(1.5)

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
                for (let i = 0; i < 6 && card.parentElement; i++) {
                    const parent = card.parentElement;
                    const ids = new Set(Array.from(parent.querySelectorAll('a[href*="/item/"]')).map(link => link.href.split('?')[0]));
                    if (ids.size > 1) break;
                    card = parent;
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
            if search and not card_matches_city(lines, search["city"]):
                continue

            price_val = card_price(card_text)
            city_val = search["city"] if search else (item.get("city") or "ישראל")
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
    payload = {
        "items": items,
        "purge_previous": False,
        "log": {
            "status": "success",
            "rent_count": rent_count,
            "sale_count": sale_count,
            "message": f"Successfully scraped and ingested {len(items)} Yad2 listings"
        }
    }

    return send_payload(payload)

async def launch_browser(max_retries=3):
    chrome_bin = None
    if os.getenv("CHROME_PATH") and os.path.exists(os.getenv("CHROME_PATH")):
        chrome_bin = os.getenv("CHROME_PATH")
    elif os.path.exists("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"):
        chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    elif shutil.which("google-chrome"):
        chrome_bin = shutil.which("google-chrome")
    elif shutil.which("google-chrome-stable"):
        chrome_bin = shutil.which("google-chrome-stable")
    elif shutil.which("chromium-browser"):
        chrome_bin = shutil.which("chromium-browser")
    elif shutil.which("chromium"):
        chrome_bin = shutil.which("chromium")

    print(f"[Scraper] Resolved Chrome binary path: {chrome_bin}")

    for attempt in range(1, max_retries + 1):
        print(f"[Scraper] Initializing nodriver Chrome session (Attempt {attempt}/{max_retries})...")
        try:
            config = uc.Config(sandbox=False, lang="he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7")
            config.add_argument("--disable-gpu")
            config.add_argument("--disable-software-rasterizer")
            config.add_argument("--window-size=1920,1080")
            config.add_argument("--start-maximized")
            config.add_argument("--no-first-run")
            config.add_argument("--disable-dev-shm-usage")
            config.add_argument("--disable-setuid-sandbox")

            if chrome_bin:
                config.browser_executable_path = chrome_bin

            config.user_data_dir = tempfile.mkdtemp(prefix="yad2_chrome_")

            browser = await uc.start(config=config, headless=False)
            print("[Scraper] Chrome browser connected successfully!")
            return browser
        except Exception as e:
            print(f"[Scraper] Attempt {attempt} failed to start browser: {e}")
            if attempt == max_retries:
                raise
            await asyncio.sleep(3)

async def main():
    ingest_config()  # Fail before launching Chrome when CI secrets are missing.
    searches = load_searches()
    print("[Scraper] Starting Yad2 Stealth Scraper (nodriver Chrome engine)...")
    browser = await launch_browser()

    try:
        rent_items = []
        sale_items = []
        for search in searches:
            items = await scrape_category(browser, search["type"], search)
            if not items:
                print(f"[Scraper] No matching cards for {search['city']} ({search['type']}); inspect page if unexpected")
            (rent_items if search["type"] == "rent" else sale_items).extend(items)
        print(f"[Scraper] Successfully scraped {len(rent_items)} rent apartments")

        await asyncio.sleep(3)

        print(f"[Scraper] Successfully scraped {len(sale_items)} sale apartments")

        all_items = list({item["id"]: item for item in rent_items + sale_items}.values())
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
            raise RuntimeError("No listings scraped; ingestion was not performed")

    finally:
        browser.stop()
        print("[Scraper] Browser session closed.")

if __name__ == "__main__":
    uc.loop().run_until_complete(main())
