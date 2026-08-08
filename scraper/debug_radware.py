from curl_cffi import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
}

r = requests.get("https://www.yad2.co.il/realestate/rent", headers=headers, impersonate="chrome120")
print("Status:", r.status_code)
print("Title tag:", r.text.split("<title>")[1].split("</title>")[0] if "<title>" in r.text else "No title")
print("Cookies:", r.cookies.get_dict())
print("Head snippet:\n", r.text[:1000])
