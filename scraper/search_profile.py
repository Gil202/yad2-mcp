"""Only confirmed matches are persisted; incomplete cards may be checked in memory."""
CITIES = {'חולון', 'בת ים', 'אזור'}


def candidate_matches(item):
    return (item.get('type') == 'sale' and item.get('city') in CITIES
            and item.get('rooms') in (None, 0, 3)
            and (item.get('floor') is None or item['floor'] >= 10))


def confirmed_match(item):
    attrs = item.get('attributes') or {}
    return (candidate_matches(item) and item.get('rooms') == 3
            and item.get('floor') is not None and item['floor'] >= 10
            and all(attrs.get(key) is True for key in ('elevator', 'parking', 'sun_terrace')))
