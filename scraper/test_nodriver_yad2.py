import asyncio
import nodriver as uc

async def main():
    print("Launching nodriver (Chrome stealth without CDP automation flags)...")
    config = uc.Config(sandbox=False)
    browser = await uc.start(config=config, headless=False)

    print("Navigating to Yad2 rent page...")
    page = await browser.get('https://www.yad2.co.il/realestate/rent')

    await asyncio.sleep(5)

    title = await page.evaluate('document.title')
    print("Loaded Page Title:", title)

    if "Radware" in str(title):
        print("Waiting 5 more seconds for Radware stormcasterv2 JS challenge to resolve...")
        await asyncio.sleep(5)
        title = await page.evaluate('document.title')
        print("Page Title after wait:", title)

    if "Radware" not in str(title):
        print("\n🎉 SUCCESS! Radware bypassed completely using nodriver!")
        
        # Count listing items or grab page title
        items_count = await page.evaluate('document.querySelectorAll("[data-test-id=\\"feed-item\\"], .feed-item, a[href*=\\"/item/\\"]").length')
        print(f"Listings found on page: {items_count}")
    else:
        print("Radware challenge still displayed.")

    browser.stop()

if __name__ == '__main__':
    uc.loop().run_until_complete(main())
