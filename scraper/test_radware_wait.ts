import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(stealthPlugin());

async function testWait() {
  console.log('Testing Radware challenge JS execution & cookie resolution...');
  const browser = await chromium.launch({
    headless: false,
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
    timezoneId: 'Asia/Jerusalem',
  });

  const page = await context.newPage();

  page.on('response', (res) => {
    if (res.url().includes('feed')) {
      console.log('Intercepted FEED API Response:', res.status(), res.url());
    }
  });

  console.log('Navigating to Yad2 rent page...');
  await page.goto('https://www.yad2.co.il/realestate/rent', { waitUntil: 'domcontentloaded' });

  console.log('Initial title:', await page.title());

  // Wait up to 15 seconds for Radware JS challenge to complete and auto-redirect to Yad2
  for (let i = 1; i <= 15; i++) {
    await page.waitForTimeout(1000);
    const currentTitle = await page.title();
    console.log(`Second ${i}: Title = "${currentTitle}"`);

    if (!currentTitle.includes('Radware')) {
      console.log(`\n🎉 RADWARE PASSED AT SECOND ${i}! Current Page Title: "${currentTitle}"`);
      const cookies = await context.cookies();
      console.log('Verified Cookies Count:', cookies.length);
      break;
    }
  }

  await browser.close();
}

testWait();
