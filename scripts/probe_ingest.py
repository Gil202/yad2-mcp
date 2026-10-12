"""Compare unauthenticated transport responses without sending credentials."""
import urllib.error
import urllib.request

for agent in (None, "yad2-monitor/1.0"):
    headers = {"Content-Type": "application/json"}
    if agent:
        headers["User-Agent"] = agent
    request = urllib.request.Request(
        "https://yad2-mcp.gil202.workers.dev/ingest", data=b'{"items":[]}', headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            print({"agent": agent, "status": response.status})
    except urllib.error.HTTPError as error:
        print({"agent": agent, "status": error.code, "ray": error.headers.get("cf-ray"),
               "body": error.read(1024).decode("utf-8", errors="replace")})
