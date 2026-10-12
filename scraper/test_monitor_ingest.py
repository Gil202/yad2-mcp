import io
import os
import unittest
import urllib.error
from unittest.mock import patch
from ingest_http import send_payload, ingest_config, NoRedirect


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"WORKER_URL": "https://worker.example", "INGEST_SECRET": "test-secret"}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_explicit_user_agent_and_success(self):
        response = io.BytesIO(b'{"success":true,"received":1}')
        with patch('urllib.request.build_opener') as opener:
            mocked = opener.return_value.open
            mocked.return_value = response
            self.assertTrue(send_payload({"items": []})['success'])
            req = mocked.call_args.args[0]
            self.assertEqual(req.get_header('User-agent'), 'yad2-monitor/1.0')
            self.assertEqual(req.get_header('X-ingest-secret'), 'test-secret')
            self.assertNotIn('Authorization', req.headers)

    def test_http_errors_fail_without_echoing_body_or_credentials(self):
        for status in (401, 403, 500):
            error = urllib.error.HTTPError('https://worker.example', status, 'test-secret', {}, io.BytesIO(b'test-secret'))
            with patch('urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(RuntimeError) as caught:
                    send_payload({"items": []})
                self.assertNotIn('test-secret', str(caught.exception))
                self.assertIn(str(status), str(caught.exception))

    def test_missing_config_and_insecure_url_fail(self):
        for values in ({'INGEST_SECRET': ''}, {'WORKER_URL': 'http://worker.example'}, {'WORKER_URL': 'https://user:pass@example.com'}):
            with patch.dict(os.environ, values):
                with self.assertRaises(RuntimeError):
                    ingest_config()

    def test_redirects_never_forward_credentials(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))

    def test_partial_access_token_rejected(self):
        with patch.dict(os.environ, {'CF_ACCESS_CLIENT_ID': 'test-id'}):
            with self.assertRaises(RuntimeError):
                send_payload({"items": []})


if __name__ == '__main__':
    unittest.main()
