import asyncio
import tempfile
import nodriver as uc

async def test():
    config = uc.Config()
    config.sandbox = False
    config.user_data_dir = tempfile.mkdtemp()
    
    browser = await uc.start(config=config, headless=False)
    page = await browser.get('https://www.yad2.co.il/realestate/rent')
    await asyncio.sleep(4)
    print("Page title:", await page.evaluate('document.title'))
    browser.stop()

if __name__ == '__main__':
    uc.loop().run_until_complete(test())
