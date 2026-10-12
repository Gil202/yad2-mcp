"""Evidence-based listing details. Absence of text is not a negative claim."""
import datetime
import re

FEATURE_WORDS = {
    'parking': r'חני{1,2}ה', 'elevator': r'מעלית', 'balcony': r'מרפסת',
    'sun_terrace': r'מרפסת\s+שמש|מרפסות\s+שמש',
    'parking_registered': r'חני{1,2}ה\s+(?:פרטית\s+)?(?:לא\s+)?ב?טאבו',
    'mamad': r'ממ["״]?ד|מרחב מוגן', 'storage': r'מחסן',
    'renovated': r'משופצ[תך]?|משופץ', 'furniture': r'מרוהט[ת]?|ריהוט',
    'air_conditioning': r'מיזוג|מזגן',
}


def clean(text):
    return re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', text or '').replace('״', '"').replace('׳', "'")


def number(text):
    match = re.search(r'\d+(?:\.\d+)?', clean(text))
    return float(match.group()) if match else None


def claims(text):
    text = clean(text)
    attributes, evidence = {key: None for key in FEATURE_WORDS}, {}
    for key, pattern in FEATURE_WORDS.items():
        positive, negative = [], []
        for match in re.finditer(pattern, text):
            prefix = text[max(0, match.start() - 18):match.start()]
            quote = text[max(0, match.start() - 18):min(len(text), match.end() + 35)]
            if re.search(r'(?:אין|ללא|בלי|לא קיימת)\s*$', prefix) or (key == 'parking_registered' and 'לא' in match.group()):
                negative.append(quote)
            else:
                positive.append(quote)
        if positive or negative:
            attributes[key] = None if positive and negative else bool(positive)
            evidence[key] = ' | '.join(positive + negative)
    if attributes['sun_terrace'] is True:
        attributes['balcony'] = True
    if attributes['parking_registered'] is True:
        attributes['parking'] = True
    return attributes, evidence


def parse_detail(item, raw, checked_at=None):
    checked_at = checked_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    if raw.get('url', '').split('?')[0].rstrip('/').split('/')[-1] != item['id']:
        raise RuntimeError('Detail page redirected to a different listing')
    description = clean(raw.get('description'))
    if not raw.get('address') or not raw.get('location') or not description:
        raise RuntimeError('Detail page was not fully loaded')
    location = clean(raw['location'])
    if not location.endswith(item['city']):
        raise RuntimeError('Detail page city differs from the stored listing')
    attributes, evidence = claims(description)
    for key, value in raw.get('features', {}).items():
        if attributes.get(key) is not None and attributes[key] != value:
            attributes[key] = None
            evidence[key] += ' | Contradicts the structured detail feature'
        else:
            attributes[key] = value
            evidence.setdefault(key, raw.get('feature_evidence', {}).get(key, 'Structured detail feature'))
    parking_count = number(raw.get('parking_count'))
    if parking_count is not None:
        parking = parking_count > 0
        if attributes['parking'] is not None and attributes['parking'] != parking:
            attributes['parking'] = None
        else:
            attributes['parking'] = parking
        evidence['parking'] = evidence.get('parking', '') + f' | Listing parking count: {parking_count:g}'
    specs = clean(raw.get('specs'))
    floor = re.search(r'קומה\s*(-?\d+)\s*/\s*(\d+)', specs)
    rooms = re.search(r'(\d+(?:\.\d+)?)\s*חדרים', specs)
    area = re.search(r'(\d+(?:\.\d+)?)\s*מ"ר', specs)
    kind = 'unknown'
    if re.search(r'תמ["\s]*א\s*38\s*/\s*1|(?:בניין|בנין)\s+(?:ישן|מחודש)|התחדשות.*חיזוק', description):
        kind = 'renewal'
    elif re.search(r'בנ(?:יי|י)ן\s+(?:חדש|בן|מפואר.*חדש)|תמ["\s]*א\s*38\s*/\s*2|פינוי\s*בינוי', description):
        kind = 'new_building'
    year = None
    age_match = re.search(r'בנ(?:יי|י)ן\s+(?:כ)?בן\s*(\d+)\s*שנ', description)
    one_year = re.search(r'בנ(?:יי|י)ן\s+בן\s+שנה', description)
    year_match = re.search(r'(?:בנ(?:יי|י)ן\s+)?(?:נבנה|נבנה בשנת|שנת בנייה|שנת בניה)\s*(20\d\d|19\d\d)', description)
    if year_match:
        year = int(year_match.group(1)); evidence['building_year'] = year_match.group()
    elif age_match or one_year:
        year = int(checked_at[:4]) - (int(age_match.group(1)) if age_match else 1)
        evidence['building_year'] = (age_match or one_year).group() + ' (approximate year from advertised age)'
    if kind == 'renewal':
        year = None  # A new added apartment does not date the original building.
    if kind != 'unknown':
        evidence['building_kind'] = next((sentence.strip() for sentence in re.split(r'[.!\n]', description)
                                          if re.search(r'בנ(?:יי|י)ן|תמ["\s]*א|פינוי', sentence)), description[:200])
    terrace = re.search(r'מרפסת\s+(?:שמש\s+)?(?:בשטח\s+)?(\d+(?:\.\d+)?)\s*מ', description)
    parking_type = 'robotic' if 'רובוט' in description else 'mechanical' if re.search(r'מכפיל|מתקן חניה|חניה מכנית', description) else None
    details = {
        'checked_at': checked_at, 'source_url': raw['url'], 'building_year': year,
        'building_kind': kind, 'parking_type': parking_type,
        'built_sqm': number(raw.get('built_sqm')), 'terrace_sqm': float(terrace.group(1)) if terrace else None,
        'entrance_date': raw.get('entrance_date') or None, 'evidence': evidence,
    }
    output = dict(item)
    output.update(description=description, address=clean(raw['address']), attributes=attributes,
                  details=details, updated_at=checked_at)
    if floor:
        output['floor'] = int(floor.group(1)); evidence['floor'] = floor.group()
    if rooms:
        output['rooms'] = float(rooms.group(1))
    if area:
        output['square_meters'] = float(area.group(1))
    if raw.get('images'):
        output['images'] = list(dict.fromkeys(raw['images']))
    parts = location.split(',')
    if len(parts) >= 3:
        output['neighborhood'] = parts[-2].strip()
    return output
