"""Contract checks for the explicitly simulated development HTTP API."""
import copy
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("dev_server", Path(__file__).resolve().parents[1] / "tools/dev_server.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


def sample(source="open-meteo"):
    now = int(time.time())
    return {"schema": 1, "source": source, "fetchedAt": now,
            "location": {"name": "서울", "latitude": 37.57, "longitude": 126.98},
            "current": {"time": now, "temperature": 20.5, "code": 0},
            "hourly": [{"time": now // 3600 * 3600 + i * 3600, "temperature": 20 + i / 10, "code": 3} for i in range(24)]}


class MockHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = dev.ThreadingHTTPServer(("127.0.0.1", 0), dev.Handler)
        cls.server.device = dev.MockDevice()
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def setUp(self):
        self.server.device = dev.MockDevice()

    def request(self, path, body=None, headers=None):
        hdr = {"Content-Type": "application/json", **(headers or {})}
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=hdr)
        try:
            with urllib.request.urlopen(req) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as response:
            return response.code, json.load(response)

    def test_settings_apply_and_reboot(self):
        status, result = self.request("/api/settings", {"character": "turtle", "emotion": "love", "view": "auto"})
        self.assertEqual((status, result["saved"]), (200, True))
        self.request("/api/time", {"epoch": int(time.time())})
        self.request("/api/debug/reboot", {})
        status, state = self.request("/api/state")
        self.assertEqual(state["character"], "turtle")
        self.assertEqual(state["emotion"], "love")
        self.assertFalse(state["clock"]["trusted"])
        self.assertTrue(state["simulated"])

    def test_invalid_settings_leave_previous_state(self):
        self.assertEqual(self.request("/api/settings", {"character": "dragon", "emotion": "happy", "view": "character"})[0], 400)
        self.assertEqual(self.request("/api/state")[1]["character"], "rabbit")

    def test_weather_cache_status_and_reset(self):
        weather = sample()
        self.assertEqual(self.request("/api/weather", weather)[0], 200)
        state = self.request("/api/state")[1]
        self.assertEqual(state["weatherStatus"], "clock-unknown")
        self.assertEqual(len(state["weather"]["hourly"]), 24)
        self.request("/api/time", {"epoch": weather["fetchedAt"]})
        self.assertEqual(self.request("/api/state")[1]["weatherStatus"], "fresh")
        self.request("/api/time", {"epoch": weather["fetchedAt"] + 10801})
        self.assertEqual(self.request("/api/state")[1]["weatherStatus"], "stale")
        self.request("/api/reset", {})
        self.assertIsNone(self.request("/api/state")[1]["weather"])

    def test_sample_always_labelled(self):
        self.request("/api/weather", sample("sample"))
        self.assertEqual(self.request("/api/state")[1]["weatherStatus"], "sample")

    def test_invalid_weather_cannot_replace_cache(self):
        weather = sample()
        self.request("/api/weather", weather)
        bad = copy.deepcopy(weather)
        bad["hourly"][2]["time"] += 1
        self.assertEqual(self.request("/api/weather", bad)[0], 400)
        self.assertEqual(self.request("/api/state")[1]["weather"], weather)

    def test_reject_cross_origin_writes(self):
        self.assertEqual(self.request("/api/reset", {}, {"Origin": "https://other.example"})[0], 403)

    def test_static_server_has_no_simulated_api_by_default(self):
        saved = self.server.device
        try:
            self.server.device = None
            self.assertEqual(self.request("/api/state")[0], 404)
        finally:
            self.server.device = saved


if __name__ == "__main__":
    unittest.main()
