import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

async function testChrome() {
  console.log('Testing Playwright with real Chrome browser channel...');
  try {
    const browser = await chromium.launch({
      headless: true,
      channel: 'chrome', // Use installed system Google Chrome!
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

    console.log('Navigating to Yad2 rent...');
    const response = await page.goto('https://www.yad2.co.il/realestate/rent', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('HTTP Status:', response?.status());
    console.log('Title:', await page.title());

    // Check if feed API calls or items exist
    await page.waitForTimeout(3000);
    console.log('Title after 3s:', await page.title());

    const isRadware = (await page.title()).includes('Radware');
    console.log('Is Radware blocked?', isRadware);

    await browser.close();
  } catch (err: any) {
    console.error('Error testing chrome channel:', err.message);
  }
}

testChrome();
