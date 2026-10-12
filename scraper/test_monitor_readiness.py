import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_status_uses_json_transport_instead_of_remote_object(self):
        spec = importlib.util.spec_from_file_location('scraper_readiness_test', Path(__file__).with_name('yad2_nodriver_scraper.py'))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'nodriver': types.SimpleNamespace()}):
            spec.loader.exec_module(module)
        page = types.SimpleNamespace(evaluate=AsyncMock(return_value=json.dumps({
            'title': 'נדל"ן להשכרה בחולון | אלפי מודעות חדשות בכל יום',
            'itemsCount': 0, 'isSecurity': False,
        })))
        with patch.object(module.asyncio, 'sleep', new=AsyncMock()):
            self.assertTrue(await module.wait_for_yad2_listings(page, 'rent', max_wait_seconds=1))
        self.assertIn('JSON.stringify', page.evaluate.call_args.args[0])
