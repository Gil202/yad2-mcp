import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from search_profile import CITIES


def load_searches():
    configured = os.environ.get('YAD2_SEARCHES', '').strip()
    searches = json.loads(configured) if configured else json.loads(Path(__file__).with_name('searches.json').read_text(encoding='utf-8'))
    if not isinstance(searches, list) or not searches:
        raise RuntimeError('YAD2_SEARCHES must be a nonempty array of city/type/url objects')
    for search in searches:
        if not isinstance(search, dict):
            raise RuntimeError('Each search must be an object')
        parsed = urlsplit(search.get('url', ''))
        expected = '/realestate/rent' if search.get('type') == 'rent' else '/realestate/forsale'
        if (search.get('type') not in ('rent', 'sale') or not search.get('city') or
                parsed.scheme != 'https' or parsed.hostname != 'www.yad2.co.il' or
                parsed.username or parsed.password or parsed.path.rstrip('/') != expected or
                not parse_qs(parsed.query).get('city')):
            raise RuntimeError('Each search requires a city, rent/sale type and city-filtered Yad2 URL')
    # Older repository variables may still contain rental searches. Never execute those.
    searches = [s for s in searches if s['type'] == 'sale' and s['city'] in CITIES]
    if not searches:
        raise RuntimeError('No sale searches in Bat Yam, Azor or Holon configured')
    return searches


def card_matches_city(lines, city):
    # Yad2 may include recommended cards from other cities on a filtered page.
    # Match location lines, rather than arbitrary prose mentioning the city.
    return any(re.search(r'(?:^|,\s*)' + re.escape(city) + r'\s*$', line.strip()) for line in lines if isinstance(line, str))


def card_price(text):
    cleaned = re.sub(r'ירד\s*ב\s*[-־]?\s*[\d,]+\s*₪', '', text)
    match = re.search(r'₪\s*([\d,]+)|([\d,]+)\s*₪', cleaned)
    return float((match.group(1) or match.group(2)).replace(',', '')) if match else 0.0


def listing_page_ready(title, item_count, is_security):
    return not is_security and (item_count > 0 or 'דירות' in title or 'יד2' in title or
                                ('נדל' in title and ('להשכרה' in title or 'למכירה' in title)))
