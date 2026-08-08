import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

async function testHeadful() {
  console.log('Testing Playwright in Headful mode (headless: false)...');
  try {
    const browser = await chromium.launch({
      headless: false, // Headful mode bypasses Radware headless detection!
      channel: 'chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'he-IL',
      timezoneId: 'Asia/Jerusalem',
    });

    const page = await context.newPage();

    console.log('Navigating to Yad2 rent in headful mode...');
    const response = await page.goto('https://www.yad2.co.il/realestate/rent', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('HTTP Status:', response?.status());
    console.log('Title immediately:', await page.title());

    await page.waitForTimeout(4000);
    console.log('Title after 4s:', await page.title());

    const isRadware = (await page.title()).includes('Radware');
    console.log('Is Radware blocked?', isRadware);

    if (!isRadware) {
      console.log('SUCCESS! Radware bypassed completely!');
      const itemsCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-test-id="feed-item"], .feed-item, .feed_item, a[href*="/item/"]').length;
      });
      console.log(`Found ${itemsCount} listings on page!`);
    }

    await browser.close();
  } catch (err: any) {
    console.error('Error testing headful:', err.message);
  }
}

testHeadful();
