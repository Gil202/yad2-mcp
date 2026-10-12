import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

from pagination import collect_pages


START = 'https://www.yad2.co.il/realestate/rent?city=6600'
CANONICAL = 'https://www.yad2.co.il/realestate/rent/tel-aviv-area?area=11&city=6600'


def result(number, ids, next_number=None, total=3, last_page=2):
    return ([{'id': value} for value in ids], {
        'url': f'{CANONICAL}&page={number}', 'total': total,
        'next_url': f'{CANONICAL}&page={next_number}' if next_number else None,
        'last_page': last_page,
    })


class PaginationTests(unittest.IsolatedAsyncioTestCase):
    async def test_follows_canonical_next_link_and_deduplicates_promoted_cards(self):
        read = AsyncMock(side_effect=[result(1, ['a', 'b'], 2), result(2, ['b', 'c'])])
        items = await collect_pages(START, read)
        self.assertEqual([item['id'] for item in items], ['a', 'b', 'c'])
        self.assertEqual([call.args[0] for call in read.call_args_list], [START, f'{CANONICAL}&page=2'])

    async def test_single_empty_search_is_valid(self):
        self.assertEqual(await collect_pages(START, AsyncMock(return_value=result(1, [], total=0, last_page=1))), [])

    async def test_rejects_partial_or_looping_searches(self):
        cases = [
            [result(1, ['a'], 1)],
            [result(1, ['a'], 3)],
            [result(1, ['a'])],  # next link absent, but two pages reported
            [result(1, [], total=3)],
            [result(1, ['a'], total=None)],
            [result(1, ['a'], 2), result(2, ['a'])],
            [result(1, ['a'], 2), result(1, ['b'])],  # server ignored page 2
            [result(1, ['a'], 2, last_page=3), result(2, ['b'], last_page=1)],
        ]
        for pages in cases:
            with self.subTest(pages=pages), self.assertRaises(RuntimeError):
                await collect_pages(START, AsyncMock(side_effect=pages))

    async def test_next_link_cannot_leave_city_type_or_host(self):
        for next_url in (
            f'{CANONICAL}&page=2'.replace('6600', '6200'),
            f'{CANONICAL}&page=2'.replace('/rent/', '/forsale/'),
            f'{CANONICAL}&page=2'.replace('www.yad2.co.il', 'other.example'),
            'https://www.yad2.co.il/realestate/rent?page=2',
        ):
            items, state = result(1, ['a'], 2)
            state['next_url'] = next_url
            with self.subTest(url=next_url), self.assertRaises(RuntimeError):
                await collect_pages(START, AsyncMock(return_value=(items, state)))

    async def test_safety_limit_is_failure_not_success(self):
        read = AsyncMock(side_effect=[result(1, ['a'], 2), result(2, ['b'], 3)])
        with self.assertRaisesRegex(RuntimeError, 'safety limit'):
            await collect_pages(START, read, max_pages=1)
        self.assertEqual(read.await_count, 1)

    async def test_page_failure_propagates_before_any_ingestion(self):
        read = AsyncMock(side_effect=[result(1, ['a'], 2), RuntimeError('blocked')])
        with self.assertRaisesRegex(RuntimeError, 'blocked'):
            await collect_pages(START, read)

    async def test_configured_room_filter_must_survive_navigation(self):
        start = START + '&rooms=3-4'
        with self.assertRaisesRegex(RuntimeError, 'filters'):
            await collect_pages(start, AsyncMock(return_value=result(1, ['a'], 2)))

    async def test_scraper_integration_filters_recommendations_across_pages(self):
        spec = importlib.util.spec_from_file_location('pagination_scraper_test', Path(__file__).with_name('yad2_nodriver_scraper.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'nodriver': types.SimpleNamespace()}):
            spec.loader.exec_module(module)
        pages = []
        for number, ids, next_number in ((1, ['a', 'promoted'], 2), (2, ['promoted', 'b'], None)):
            _, state = result(number, ids, next_number)
            cards = [{'id': value, 'url': f'https://www.yad2.co.il/realestate/item/{value}',
                      'text': '₪ 5,000\nדירה, חולון\n3 חדרים',
                      'lines': ['₪ 5,000', 'דירה, חולון', '3 חדרים']} for value in ids]
            cards.append({'id': 'foreign', 'lines': ['דירה, בת ים']})
            page = types.SimpleNamespace(evaluate=AsyncMock(side_effect=[None, None, None, json.dumps({'items': cards, 'state': state})]))
            pages.append(page)
        browser = types.SimpleNamespace(get=AsyncMock(side_effect=pages))
        with patch.object(module, 'wait_for_yad2_listings', new=AsyncMock(return_value=True)), patch.object(module.asyncio, 'sleep', new=AsyncMock()):
            items = await module.scrape_category(browser, 'rent', {'city': 'חולון', 'type': 'rent', 'url': START})
        self.assertEqual([item['id'] for item in items], ['a', 'promoted', 'b'])
        self.assertEqual(browser.get.await_count, 2)
        self.assertTrue(all(item['price'] == 5000 and item['rooms'] == 3 for item in items))


if __name__ == '__main__':
    unittest.main()
