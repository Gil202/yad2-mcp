import asyncio
import json
import nodriver as uc

async def test_extract():
    print("Testing clean link & card extraction...")
    browser = await uc.start(headless=False)
    page = await browser.get('https://www.yad2.co.il/realestate/rent')

    await asyncio.sleep(5)
    await page.evaluate('window.scrollBy(0, 1000)')
    await asyncio.sleep(2)

    extracted = await page.evaluate('''
        (() => {
            const links = Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.includes('/item/'));
            const seen = new Set();
            const items = [];

            links.forEach((a, idx) => {
                const href = a.href;
                if (seen.has(href)) return;
                seen.add(href);

                let card = a;
                for (let i = 0; i < 4; i++) {
                    if (card.parentElement) card = card.parentElement;
                }

                const text = card.innerText || '';
                const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);

                const priceMatch = text.match(/[\\d,]+\\s*₪/);
                const imgEl = card.querySelector('img');

                items.push({
                    id: href.split('?')[0].split('/').pop() || `id_${idx}`,
                    url: href,
                    title: lines[0] || 'דירה להשכרה',
                    city: lines[1] || 'ישראל',
                    address: lines[2] || '',
                    price: priceMatch ? priceMatch[0] : '0 ₪',
                    image: imgEl ? imgEl.src : '',
                    lines: lines.slice(0, 5)
                });
            });

            return items;
        })()
    ''')

    print(f"Successfully extracted {len(extracted)} items!")
    if extracted:
        print("\nSample Item 1:")
        print(json.dumps(extracted[0], ensure_ascii=False, indent=2))
        print("\nSample Item 2:")
        print(json.dumps(extracted[1], ensure_ascii=False, indent=2))

    browser.stop()

if __name__ == '__main__':
    uc.loop().run_until_complete(test_extract())
