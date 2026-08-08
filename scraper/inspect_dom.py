import asyncio
import json
import nodriver as uc

async def inspect_dom():
    print("Launching nodriver to inspect Yad2 DOM selectors...")
    browser = await uc.start(headless=False)
    page = await browser.get('https://www.yad2.co.il/realestate/rent')

    await asyncio.sleep(6)

    # Scroll down to ensure content renders
    await page.evaluate('window.scrollBy(0, 800)')
    await asyncio.sleep(2)

    dom_summary = await page.evaluate('''
        (() => {
            const allLinks = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.includes('/item/'));
            const feedContainers = Array.from(document.querySelectorAll('div, section, article')).filter(el => {
                return el.className && typeof el.className === 'string' && (el.className.includes('feed') || el.className.includes('item'));
            }).slice(0, 10).map(el => ({ tag: el.tagName, class: el.className }));

            const nextDataKeys = window.__NEXT_DATA__ ? Object.keys(window.__NEXT_DATA__.props.pageProps) : [];

            return {
                title: document.title,
                notice_links_count: allLinks.length,
                sample_links: allLinks.slice(0, 5),
                next_data_keys: nextDataKeys,
                sample_containers: feedContainers
            };
        })()
    ''')

    print("\n--- DOM Inspection Summary ---")
    print(json.dumps(dom_summary, ensure_ascii=False, indent=2))

    browser.stop()

if __name__ == '__main__':
    uc.loop().run_until_complete(inspect_dom())
