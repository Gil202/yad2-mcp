import json
from curl_cffi import requests

def test_yad2():
    print("Testing Yad2 with curl_cffi (Chrome 120 TLS impersonation)...")
    
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "max-age=0",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    url = "https://www.yad2.co.il/realestate/rent"
    
    response = requests.get(url, headers=headers, impersonate="chrome120", timeout=15)
    
    print("HTTP Status Code:", response.status_code)
    print("Response Length:", len(response.text))
    
    if "Radware" in response.text or "ShieldSquare" in response.text or "Verifying your browser" in response.text:
        print("Result: BLOCKED by Radware")
    else:
        print("Result: SUCCESS! Bypassed Radware completely!")
        if "<title>" in response.text:
            title = response.text.split("<title>")[1].split("</title>")[0]
            print("Page Title:", title)

    # Now let's try the Yad2 internal feed API endpoint
    api_url = "https://www.yad2.co.il/api/v1.0/feed/feed.jsp?cat=2&subcat=2"
    api_response = requests.get(api_url, headers=headers, impersonate="chrome120", timeout=15)
    print("\nAPI HTTP Status Code:", api_response.status_code)
    try:
        data = api_response.json()
        items = data.get("feed", {}).get("feed_items", [])
        print(f"API Result: SUCCESS! Retrieved {len(items)} apartment listings from API feed!")
        if items:
            sample = items[0]
            print("\nSample Listing Extracted:")
            print("ID:", sample.get("id") or sample.get("token"))
            print("Title:", sample.get("title") or sample.get("line_1"))
            print("City:", sample.get("city") or sample.get("city_code_title"))
            print("Price:", sample.get("price"))
            print("Rooms:", sample.get("rooms"))
            print("Link Token / Notice URL:", sample.get("link_token"))
    except Exception as e:
        print("API Response parsing:", e)

if __name__ == "__main__":
    test_yad2()
