import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import { sendIngestData } from './ingest';

dotenv.config();

// Enable stealth plugin to bypass Radware ShieldSquare / Cloudflare bot protection
chromium.use(stealthPlugin());

export interface ScrapedApartment {
  id: string;
  title: string;
  type: 'rent' | 'sale';
  city: string;
  neighborhood?: string;
  address?: string;
  price: number;
  rooms: number;
  floor?: number;
  square_meters?: number;
  description?: string;
  url: string; // Link to listing notice!
  images: string[];
  contact_name?: string;
  contact_phone?: string;
  attributes: Record<string, boolean>;
  scraped_at: string;
  updated_at: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrapeYad2Category(page: any, categoryType: 'rent' | 'sale'): Promise<ScrapedApartment[]> {
  const targetUrl = categoryType === 'rent'
    ? 'https://www.yad2.co.il/realestate/rent'
    : 'https://www.yad2.co.il/realestate/forsale';

  console.log(`[Scraper] Navigating to Yad2 (${categoryType.toUpperCase()}): ${targetUrl}`);

  const items: ScrapedApartment[] = [];
  const interceptedItems: any[] = [];

  // Listen for feed JSON API responses
  page.on('response', async (response: any) => {
    const url = response.url();
    if (url.includes('/api/v1.0/feed/feed.jsp') || url.includes('/realestate/rent') || url.includes('/realestate/forsale') || url.includes('feed')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const json = await response.json();
          if (json && json.feed && json.feed.feed_items) {
            interceptedItems.push(...json.feed.feed_items);
            console.log(`[Scraper] Intercepted ${json.feed.feed_items.length} items from Yad2 feed API`);
          }
        }
      } catch (e) {
        // Ignore response parse errors for non-JSON
      }
    }
  });

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Simulate real human interactions to satisfy ShieldSquare protection
    await page.mouse.move(100 + Math.random() * 200, 100 + Math.random() * 200);
    await delay(2000);
    await page.evaluate(() => window.scrollBy(0, 400));
    await delay(1500);
    await page.evaluate(() => window.scrollBy(0, 600));
    await delay(2000);

    // If initial load redirected to bot challenge, wait up to 10s for page JS initialization
    const pageTitle = await page.title();
    console.log(`[Scraper] Page loaded. Title: "${pageTitle}"`);

    // Parse items either from intercepted API feed or directly from DOM window state
    const windowStateItems = await page.evaluate(() => {
      try {
        // Try reading Yad2 SSR initial state object if present
        const win = window as any;
        if (win.__NEXT_DATA__?.props?.pageProps?.dehydratedState?.queries) {
          const queries = win.__NEXT_DATA__.props.pageProps.dehydratedState.queries;
          for (const q of queries) {
            if (q.state?.data?.feed?.feed_items) {
              return q.state.data.feed.feed_items;
            }
          }
        }
        if (win.yad2State?.feed?.feed_items) {
          return win.yad2State.feed.feed_items;
        }
      } catch (e) {
        return null;
      }
      return null;
    });

    const rawFeedItems = (windowStateItems && windowStateItems.length > 0) ? windowStateItems : interceptedItems;

    if (rawFeedItems && rawFeedItems.length > 0) {
      console.log(`[Scraper] Processing ${rawFeedItems.length} raw feed items...`);
      for (const item of rawFeedItems) {
        if (!item || !item.id) continue;

        const itemId = String(item.id || item.token);
        const noticeUrl = item.link_token 
          ? `https://www.yad2.co.il/item/${item.link_token}`
          : `https://www.yad2.co.il/item/${itemId}`;

        const priceNum = typeof item.price === 'number' 
          ? item.price 
          : parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0;

        const roomsNum = typeof item.rooms === 'number'
          ? item.rooms
          : parseFloat(String(item.rooms || '0')) || 0;

        const sqmNum = typeof item.SquareMeter === 'number'
          ? item.SquareMeter
          : parseFloat(String(item.SquareMeter || item.square_meters || '0')) || 0;

        const floorNum = parseInt(String(item.floor || '0'), 10) || undefined;

        // Parse attributes
        const attributes: Record<string, boolean> = {
          elevator: Boolean(item.Elevator || item.elevator || item.attributes?.elevator),
          parking: Boolean(item.Parking || item.parking || item.attributes?.parking),
          mamad: Boolean(item.Mamad || item.mamad || item.attributes?.mamad),
          balcony: Boolean(item.Balcony || item.balcony || item.attributes?.balcony),
          renovated: Boolean(item.Renovated || item.renovated),
          furniture: Boolean(item.Furniture || item.furniture),
          air_conditioning: Boolean(item.AirConditioner || item.air_conditioning),
        };

        const images: string[] = [];
        if (item.images && Array.isArray(item.images)) {
          images.push(...item.images.map((img: any) => typeof img === 'string' ? img : img.src || img.url).filter(Boolean));
        } else if (item.img_url) {
          images.push(item.img_url);
        }

        const now = new Date().toISOString();

        const streetStr = item.street || item.street_title || item.street_code_title || undefined;
        const addressStr = item.address || item.line_2 || (streetStr && item.house_number ? `${streetStr} ${item.house_number}` : streetStr) || undefined;

        items.push({
          id: itemId,
          title: item.title || item.line_1 || `דירה ל${categoryType === 'rent' ? 'השכרה' : 'מכירה'} ב${item.city || ''}`,
          type: categoryType,
          city: item.city || item.city_code_title || item.city_text || 'לא צוין',
          neighborhood: item.neighborhood || item.neighborhood_code_title || item.neighborhood_text || undefined,
          address: addressStr,
          price: priceNum,
          rooms: roomsNum,
          floor: floorNum,
          square_meters: sqmNum > 0 ? sqmNum : undefined,
          description: item.description || item.search_text || undefined,
          url: noticeUrl, // Store direct link to Yad2 listing notice!
          images: images.length > 0 ? images : ['https://assets.yad2.co.il/yad2site/y2images/realestate.jpg'],
          contact_name: item.contact_name || undefined,
          contact_phone: item.contact_phone || undefined,
          attributes,
          scraped_at: now,
          updated_at: now,
        });
      }
    } else {
      console.log(`[Scraper] Fallback: Scraping listing cards directly from DOM...`);

      const domItems = await page.evaluate((type: string) => {
        const cards = Array.from(document.querySelectorAll('[data-test-id="feed-item"], .feed-item, .feed_item'));
        const nowStr = new Date().toISOString();

        return cards.map((card, idx) => {
          const titleEl = card.querySelector('.title, .feed_item_title, [class*="title"]');
          const priceEl = card.querySelector('.price, .feed_item_price, [class*="price"]');
          const addressEl = card.querySelector('.address, .feed_item_address, [class*="subtitle"]');
          const linkEl = card.querySelector('a[href*="/item/"], a[href*="realestate"]');

          const rawHref = linkEl ? (linkEl as HTMLAnchorElement).href : '';
          const itemId = rawHref.split('/').pop() || `scraped_${type}_${Date.now()}_${idx}`;
          const fullNoticeUrl = rawHref.startsWith('http') ? rawHref : `https://www.yad2.co.il/item/${itemId}`;

          const priceText = priceEl ? priceEl.textContent || '0' : '0';
          const parsedPrice = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;

          return {
            id: itemId,
            title: titleEl?.textContent?.trim() || `דירה ל${type === 'rent' ? 'השכרה' : 'מכירה'}`,
            type: type as 'rent' | 'sale',
            city: addressEl?.textContent?.trim() || 'ישראל',
            price: parsedPrice,
            rooms: 3,
            url: fullNoticeUrl,
            images: [],
            attributes: {},
            scraped_at: nowStr,
            updated_at: nowStr,
          };
        });
      }, categoryType);

      items.push(...domItems);
    }
  } catch (err: any) {
    console.error(`[Scraper] Error scraping Yad2 ${categoryType}:`, err.message);
  }

  return items;
}

export async function runScraper() {
  console.log('[Scraper] Starting Yad2 Stealth Scraper...');

  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    extraHTTPHeaders: {
      'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    },
  });

  const page = await context.newPage();

  try {
    const rentApartments = await scrapeYad2Category(page, 'rent');
    console.log(`[Scraper] Successfully scraped ${rentApartments.length} rent apartments`);

    await delay(3000);

    const saleApartments = await scrapeYad2Category(page, 'sale');
    console.log(`[Scraper] Successfully scraped ${saleApartments.length} sale apartments`);

    const allItems = [...rentApartments, ...saleApartments];
    console.log(`[Scraper] Total apartments scraped: ${allItems.length}`);

    if (allItems.length > 0) {
      await sendIngestData(
        allItems,
        {
          status: 'success',
          rent_count: rentApartments.length,
          sale_count: saleApartments.length,
          message: `Scraped ${allItems.length} items successfully`,
        },
        true // Purge previous listings before writing fresh weekly data
      );
    } else {
      console.warn('[Scraper] Warning: 0 items scraped. Yad2 page layout or bot detection triggered.');
    }
  } catch (err: any) {
    console.error('[Scraper] Scraper execution failed:', err);
  } finally {
    await browser.close();
    console.log('[Scraper] Browser closed. Scraping run complete.');
  }
}

if (require.main === module) {
  runScraper();
}
