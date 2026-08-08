import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

async function testRadware() {
  const browser = await chromium.launch({
    headless: false, // Try non-headless or headless with args
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'he-IL',
  });

  const page = await context.newPage();

  console.log('Navigating to Yad2 rent...');
  await page.goto('https://www.yad2.co.il/realestate/rent', { waitUntil: 'networkidle', timeout: 60000 });

  console.log('Title after networkidle:', await page.title());
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Body snippet:', bodyText);

  // Wait 5 seconds to see if Radware JS challenge auto-redirects
  await page.waitForTimeout(5000);
  console.log('Title after 5s wait:', await page.title());

  await browser.close();
}

testRadware();
