import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

async function debugRadware() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  page.on('console', (msg) => console.log('PAGE CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await page.goto('https://www.yad2.co.il/realestate/rent');
  await page.waitForTimeout(5000);

  const scripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script')).map((s) => s.src || s.innerText.substring(0, 100));
  });

  console.log('Scripts on Radware Page:', scripts);

  await browser.close();
}

debugRadware();
