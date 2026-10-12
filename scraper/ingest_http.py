"""Credential-safe ingestion transport shared by the scraper and unit tests."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward ingestion credentials to another endpoint.


def ingest_config():
    url = os.environ.get("WORKER_URL", "").strip().rstrip("/")
    secret = os.environ.get("INGEST_SECRET", "")
    parsed = urllib.parse.urlsplit(url)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError("WORKER_URL must be a base URL without credentials, query or fragment")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise RuntimeError("WORKER_URL requires HTTPS (except local development)")
    if not secret or secret != secret.strip():
        raise RuntimeError("INGEST_SECRET must be set without surrounding whitespace")
    return url, secret


def send_payload(payload):
    url, secret = ingest_config()
    headers = {
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "yad2-monitor/1.0", "X-Ingest-Secret": secret,
    }
    client_id = os.environ.get("CF_ACCESS_CLIENT_ID")
    client_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if bool(client_id) != bool(client_secret):
        raise RuntimeError("Both Cloudflare Access service token variables must be set together")
    if client_id:
        headers.update({"CF-Access-Client-Id": client_id, "CF-Access-Client-Secret": client_secret})
    request = urllib.request.Request(url + "/ingest", data=json.dumps(payload).encode("utf-8"),
                                     headers=headers, method="POST")
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            result = json.load(response)
            if result.get("success") is not True:
                raise RuntimeError("Worker did not acknowledge successful ingestion")
            print(f"[Ingest] Accepted {result.get('received', 0)} listings")
            return result
    except urllib.error.HTTPError as error:
        # Response bodies and redirect locations may contain sensitive material.
        hint = "Check the matching ingestion secrets" if error.code == 401 else "Check Cloudflare edge policy" if error.code == 403 else "Check Worker logs"
        raise RuntimeError(f"Ingestion HTTP {error.code}. {hint}.") from None
    except urllib.error.URLError:
        raise RuntimeError("Ingestion network failure; no successful upload was acknowledged") from None


def get_detail_queue(limit=300):
    url, secret = ingest_config()
    headers = {'Accept': 'application/json', 'User-Agent': 'yad2-monitor/1.0', 'X-Ingest-Secret': secret}
    client_id, client_secret = os.environ.get('CF_ACCESS_CLIENT_ID'), os.environ.get('CF_ACCESS_CLIENT_SECRET')
    if bool(client_id) != bool(client_secret):
        raise RuntimeError('Both Cloudflare Access service token variables must be set together')
    if client_id:
        headers.update({'CF-Access-Client-Id': client_id, 'CF-Access-Client-Secret': client_secret})
    request = urllib.request.Request(url + f'/detail-queue?limit={limit}', headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            items = json.load(response).get('items')
            if not isinstance(items, list):
                raise RuntimeError('Worker returned an invalid detail backlog')
            return items
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Detail queue HTTP {error.code}; check Worker access and deployment') from None
    except urllib.error.URLError:
        raise RuntimeError('Detail queue network failure') from None
