"""Offline security and HTTP smoke tests; no Gemini key or external API needed."""
import importlib.util
import json
from pathlib import Path
import sys
from http.server import ThreadingHTTPServer
import http.client
from threading import Thread
from unittest import TestCase, main
from unittest.mock import patch

server_path = Path(__file__).resolve().parents[1] / "backend" / "server.py"
spec = importlib.util.spec_from_file_location("clickshield_server", server_path)
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
TEST_ORIGIN = "chrome-extension://" + "a" * 32

class BackendTests(TestCase):
    @classmethod
    def setUpClass(cls):
        api.ALLOWED_ORIGIN = TEST_ORIGIN
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
        cls.port = cls.server.server_address[1]
        cls.worker = Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=3)

    def request(self, method, path, payload=None, origin=TEST_ORIGIN):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        body = None if payload is None else json.dumps(payload).encode()
        headers = {"Origin": origin, "Content-Type": "application/json"}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read()), dict(response.getheaders())
        connection.close()
        return result

    def test_health_does_not_expose_key(self):
        status, data, _ = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {"status", "keyConfigured", "extensionConfigured"})

    def test_disallowed_origin(self):
        status, _, headers = self.request("POST", "/api/explain", {"level":"high", "indicators":["fee"]}, "https://bad.example")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_rejects_arbitrary_page_text(self):
        status, _, _ = self.request("POST", "/api/explain", {"level":"high", "indicators":["inject arbitrary private webpage content"]})
        self.assertEqual(status, 400)

    def test_cors_preflight(self):
        status, _, headers = self.request("OPTIONS", "/api/explain")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], TEST_ORIGIN)

    def test_explain_uses_only_known_labels(self):
        with patch.object(api, "ask_gemini", return_value="This may warrant caution; verify independently.") as mock:
            status, data, headers = self.request("POST", "/api/explain", {"level":"high", "indicators":["fee", "urgency"]})
        self.assertEqual(status, 200)
        self.assertIn("verify independently", data["explanation"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], TEST_ORIGIN)
        self.assertEqual(mock.call_args.args[0], "high")
        self.assertTrue(all(x in api.INDICATORS.values() for x in mock.call_args.args[1]))

if __name__ == "__main__": main()
