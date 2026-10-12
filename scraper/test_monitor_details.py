import unittest
import json
from pathlib import Path
from details import claims, parse_detail


ITEM = {'id': 'sample', 'city': 'חולון', 'type': 'sale', 'price': 2040000, 'rooms': 3,
        'images': [], 'url': 'https://www.yad2.co.il/realestate/item/sample',
        'scraped_at': '2026-10-12T00:00:00Z', 'updated_at': '2026-10-12T00:00:00Z'}


def raw(description):
    return {'url': ITEM['url'], 'address': 'חסדאי', 'location': 'דירה, גרין ועם, חולון',
            'description': description, 'specs': '3חדרים\nקומה\u200e6\u200f/8\n75מ״ר',
            'built_sqm': '65 מ״ר', 'parking_count': '1', 'features': {'elevator': True},
            'feature_evidence': {'elevator': 'מעלית: marked present'}, 'entrance_date': 'כניסה גמישה'}


class DetailTests(unittest.TestCase):
    def test_captured_live_detail_fixture(self):
        source = json.loads(Path(__file__).with_name('fixtures').joinpath('hassadai.json').read_text(encoding='utf-8'))
        item = dict(ITEM, id='o34hxufn')
        result = parse_detail(item, source, '2026-10-12T12:00:00Z')
        self.assertEqual(result['floor'], 6)
        self.assertEqual(result['square_meters'], 75)
        self.assertEqual(result['details']['built_sqm'], 65)
        self.assertEqual(result['details']['building_year'], 2025)
        self.assertTrue(result['attributes']['parking_registered'])
        self.assertTrue(result['attributes']['sun_terrace'])
        self.assertFalse(result['attributes']['storage'])
    def test_missing_is_unknown_and_balcony_is_not_sun_terrace(self):
        attrs, _ = claims('דירה עם מרפסת וחניה')
        self.assertTrue(attrs['balcony']); self.assertTrue(attrs['parking'])
        self.assertIsNone(attrs['sun_terrace']); self.assertIsNone(attrs['parking_registered'])
        self.assertIsNone(attrs['elevator'])

    def test_explicit_negative_and_contradictory_claims(self):
        attrs, _ = claims('ללא מעלית. חניה לא בטאבו. מרפסת שמש')
        self.assertFalse(attrs['elevator']); self.assertFalse(attrs['parking_registered'])
        self.assertTrue(attrs['sun_terrace'])
        self.assertIsNone(claims('ללא מעלית. בבניין מעלית')[0]['elevator'])

    def test_real_hassadai_claims_and_bidi_floor(self):
        result = parse_detail(ITEM, raw('דירת 3 חדרים חדשה (בניין בן שנה). מרפסת שמש. מעלית. חניה בטאבו.'), '2026-10-12T12:00:00Z')
        self.assertEqual(result['floor'], 6); self.assertEqual(result['square_meters'], 75)
        self.assertEqual(result['details']['building_year'], 2025)
        self.assertEqual(result['details']['building_kind'], 'new_building')
        self.assertTrue(result['attributes']['parking_registered']); self.assertTrue(result['attributes']['sun_terrace'])
        self.assertIn('חניה בטאבו', result['details']['evidence']['parking_registered'])
        self.assertEqual(result['neighborhood'], 'גרין ועם')

    def test_apartment_age_never_becomes_building_age(self):
        result = parse_detail(ITEM, raw('דירה חדשה בת שנה, בניין חדש ומפואר. מרפסת שמש 8 מ"ר'), '2026-10-12T12:00:00Z')
        self.assertIsNone(result['details']['building_year'])
        self.assertEqual(result['details']['terrace_sqm'], 8)

    def test_tama_renewal_and_mechanical_parking(self):
        result = parse_detail(ITEM, raw('פנטהאוז חדש במסגרת תמ"א 38/1. בניין בן שנה. חניה בטאבו במכפיל. מרפסות שמש.'), '2026-10-12T12:00:00Z')
        self.assertEqual(result['details']['building_kind'], 'renewal')
        self.assertIsNone(result['details']['building_year'])
        self.assertEqual(result['details']['parking_type'], 'mechanical')
        self.assertTrue(result['attributes']['sun_terrace'])

    def test_disabled_structured_amenity_and_conflicting_description(self):
        source = raw('ללא מחסן. אין מעלית.')
        source['features']['storage'] = False
        result = parse_detail(ITEM, source)
        self.assertFalse(result['attributes']['storage'])
        self.assertIsNone(result['attributes']['elevator'])

    def test_redirect_other_city_and_missing_description_rejected(self):
        for key, value in [('url', 'https://www.yad2.co.il/realestate/item/other'), ('location', 'דירה, בת ים'), ('description', '')]:
            source = raw('דירה חדשה'); source[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                parse_detail(ITEM, source)


if __name__ == '__main__':
    unittest.main()
