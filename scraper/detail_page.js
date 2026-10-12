(() => {
    const read = id => document.querySelector(`[data-testid="${id}"]`)?.innerText.trim() || '';
    const description = read('property-description');
    const allText = document.body.innerText || '';
    const beforeDescription = description ? allText.slice(0, allText.indexOf(description)) : '';
    const features = {};
    const featureEvidence = {};
    const ids = {elevator: 'elevator', balcony: 'balcony', storage: 'warehouse',
        mamad: 'security-room', accessibility: 'handicap-access', air_conditioning: 'air-conditioning',
        furniture: 'furnished', renovated: 'renovated', bars: 'bars'};
    for (const [key, id] of Object.entries(ids)) {
        const element = document.querySelector(`li[data-testid="${id}-item"]`);
        if (!element) continue;
        features[key] = !element.className.includes('__disabled');
        featureEvidence[key] = `${element.innerText.trim()}: ${features[key] ? 'marked present' : 'marked absent'} on listing detail page`;
    }
    return JSON.stringify({
        title: document.title, url: location.href,
        address: document.querySelector('h1')?.innerText.trim() || '',
        location: read('address'), description,
        specs: Array.from(document.querySelectorAll('[data-testid="building-text"]')).slice(0, 3)
            .map(el => Array.from(el.parentElement.children).map(child => child.innerText).join(' ')).join('\n') || beforeDescription.slice(-1000),
        features, feature_evidence: featureEvidence,
        parking_count: read('parking-value'), built_sqm: read('square-meter-build-value'),
        building_floors: read('building-top-floor-value'), entrance_date: read('entrance-date-value'),
        condition: read('property-condition-value'),
        images: Array.from(document.querySelectorAll('img')).filter(img => img.src.includes('img.yad2.co.il') &&
            img.alt.includes(document.querySelector('h1')?.innerText.trim() || '\0')).map(img => img.src)
    });
})()
