import unittest
from search_profile import candidate_matches, confirmed_match


class ProfileTests(unittest.TestCase):
    def test_every_required_field_is_enforced_before_storage(self):
        item = dict(type='sale', city='חולון', rooms=3, floor=10,
                    attributes=dict(elevator=True, parking=True, sun_terrace=True))
        self.assertTrue(confirmed_match(item))
        for key, value in [('type', 'rent'), ('city', 'תל אביב'), ('rooms', 3.5),
                           ('rooms', 0), ('floor', 9), ('floor', None)]:
            self.assertFalse(confirmed_match(dict(item, **{key: value})))
        for feature in item['attributes']:
            for value in (None, False):
                self.assertFalse(confirmed_match(dict(item, attributes={**item['attributes'], feature: value})))
        self.assertFalse(confirmed_match(dict(item, attributes=dict(balcony=True, parking=True, elevator=True))))

    def test_incomplete_cards_can_be_checked_but_never_stored(self):
        item = dict(type='sale', city='בת ים', rooms=0, floor=None)
        self.assertTrue(candidate_matches(item))
        self.assertFalse(confirmed_match(item))
        self.assertFalse(candidate_matches(dict(item, rooms=4)))
