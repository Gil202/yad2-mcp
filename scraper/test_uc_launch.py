import asyncio
import nodriver as uc

async def test():
    config = uc.Config(sandbox=False)
    config.browser_executable_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    config.user_data_dir = "/tmp/nodriver_yad2_profile"
    
    print("Launching nodriver with explicit browser_executable_path...")
    browser = await uc.start(config=config, headless=False)
    print("Browser started successfully!")
    page = await browser.get('https://www.yad2.co.il/realestate/rent')
    await asyncio.sleep(4)
    print("Page title:", await page.evaluate('document.title'))
    browser.stop()

if __name__ == '__main__':
    uc.loop().run_until_complete(test())
