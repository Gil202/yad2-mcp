import os
import unittest
from unittest.mock import patch
from search_config import load_searches, card_matches_city, card_price


class SearchConfigTests(unittest.TestCase):
    def test_default_cities_and_both_transaction_types(self):
        with patch.dict(os.environ, {'YAD2_SEARCHES': ''}):
            searches = load_searches()
        self.assertEqual(len(searches), 6)
        self.assertEqual({s['city'] for s in searches}, {'חולון', 'בת ים', 'אזור'})
        self.assertEqual({s['type'] for s in searches}, {'rent', 'sale'})

    def test_unfiltered_or_foreign_urls_rejected(self):
        for config in ('[]', '[{"city":"חולון","type":"rent","url":"https://www.yad2.co.il/realestate/rent"}]',
                       '[{"city":"חולון","type":"rent","url":"https://other.example/realestate/rent?city=6600"}]'):
            with patch.dict(os.environ, {'YAD2_SEARCHES': config}):
                with self.assertRaises(RuntimeError):
                    load_searches()

    def test_recommendations_do_not_become_city_listings(self):
        self.assertTrue(card_matches_city(['דירה, מרכז העיר, חולון'], 'חולון'))
        self.assertTrue(card_matches_city(['בת ים'], 'בת ים'))
        self.assertFalse(card_matches_city(['דירה, תל אביב יפו'], 'חולון'))
        self.assertFalse(card_matches_city(['ליד חולון'], 'חולון'))

    def test_current_price_ignores_advertised_drop_amount(self):
        self.assertEqual(card_price('ירד ב-300 ₪\n₪ 6,200\nדירה, חולון'), 6200)
        self.assertEqual(card_price('6,200 ₪\nדירה'), 6200)
        self.assertEqual(card_price('ירד ב-300 ₪\nמחיר לא צוין'), 0)
