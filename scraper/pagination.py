"""Traverse Yad2's observed pagination links without guessing search URLs."""
from urllib.parse import parse_qs, urlsplit


def page_key(url, search_url):
    parsed, original = urlsplit(url), urlsplit(search_url)
    query, filters = parse_qs(parsed.query), parse_qs(original.query)
    category = original.path.rstrip('/').split('/')[2]
    if (parsed.scheme != 'https' or parsed.hostname != 'www.yad2.co.il' or
            parsed.username or parsed.password or
            not (parsed.path == f'/realestate/{category}' or
                 parsed.path.startswith(f'/realestate/{category}/'))):
        raise RuntimeError('Pagination link left the configured Yad2 search')
    for name, values in filters.items():
        if name != 'page' and query.get(name) != values:
            raise RuntimeError('Pagination link changed the configured search filters')
    try:
        number = int(query.get('page', ['1'])[0])
    except ValueError:
        raise RuntimeError('Invalid pagination page number') from None
    if number < 1:
        raise RuntimeError('Invalid pagination page number')
    return number


async def collect_pages(start_url, read_page, max_pages=500):
    url, visited, listings = start_url, set(), {}
    expected_total, advertised_last_page = None, 1
    while True:
        number = page_key(url, start_url)
        if number in visited:
            raise RuntimeError('Pagination repeated a page; scrape is incomplete')
        if len(visited) >= max_pages:
            raise RuntimeError('Pagination safety limit reached; scrape is incomplete')
        visited.add(number)
        items, state = await read_page(url)
        if page_key(state['url'], start_url) != number:
            raise RuntimeError('Yad2 redirected to a different page; scrape is incomplete')
        total = state.get('total')
        advertised_last_page = max(advertised_last_page, state.get('last_page', number))
        if total is None:
            raise RuntimeError('Result total was not loaded; scrape is incomplete')
        if expected_total is None:
            expected_total = total
        if not items and total > 0:
            raise RuntimeError('A nonempty search returned no matching cards; scrape is incomplete')
        previous_count = len(listings)
        for item in items:
            listings.setdefault(item['id'], item)
        if items and len(listings) == previous_count:
            raise RuntimeError('Page returned only repeated listings; scrape is incomplete')
        print(f'[Scraper] Page {number}: {len(items)} cards, {len(listings)} unique listings; site reports {total}')
        next_url = state.get('next_url')
        if not next_url:
            if number < advertised_last_page:
                raise RuntimeError('Next-page link missing before final page; scrape is incomplete')
            break
        if page_key(next_url, start_url) != number + 1:
            raise RuntimeError('Pagination skipped or repeated a page; scrape is incomplete')
        url = next_url
    print(f'[Scraper] Completed {len(visited)} pages: {len(listings)} unique cards / {expected_total} reported results. '
          'Totals may differ because of promoted cards, projects, or changes during the crawl.')
    return list(listings.values())
