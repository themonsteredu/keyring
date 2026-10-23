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


def program(enabled=True, loop=True):
    return {"schema": 1, "enabled": enabled, "loop": loop, "blocks": [
        {"type": "character", "value": "cat"},
        {"type": "emotion", "value": "excited"},
        {"type": "wait", "ms": 30000},
    ]}


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
        self.assertTrue(state["capabilities"]["blockPrograms"])

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

    def test_program_save_restore_and_controls(self):
        candidate = program()
        self.assertEqual(self.request("/api/program", candidate), (200, {"ok": True, "saved": True}))
        state = self.request("/api/state")[1]
        self.assertEqual(state["program"], candidate)
        self.assertTrue(state["programRunning"])
        self.assertEqual(state["rendered"], {"character": "cat", "emotion": "excited", "view": "character"})
        self.assertTrue(state["simulated"])
        self.request("/api/time", {"epoch": int(time.time())})
        self.assertEqual(self.request("/api/debug/reboot", {})[0], 200)
        state = self.request("/api/state")[1]
        self.assertEqual(state["program"], candidate)
        self.assertTrue(state["programRunning"])
        self.assertFalse(state["clock"]["trusted"])
        self.assertEqual(self.request("/api/program/control", {"action": "stop"})[0], 200)
        state = self.request("/api/state")[1]
        self.assertFalse(state["program"]["enabled"])
        self.assertFalse(state["programRunning"])
        self.assertEqual(state["rendered"], {"character": "rabbit", "emotion": "happy", "view": "character"})
        self.request("/api/debug/reboot", {})
        self.assertFalse(self.request("/api/state")[1]["programRunning"])
        self.assertEqual(self.request("/api/program/control", {"action": "start"})[0], 200)
        self.assertTrue(self.request("/api/state")[1]["programRunning"])

    def test_disabled_program_never_autoruns(self):
        candidate = program(enabled=False)
        self.assertEqual(self.request("/api/program", candidate)[0], 200)
        self.request("/api/debug/reboot", {})
        state = self.request("/api/state")[1]
        self.assertEqual(state["program"], candidate)
        self.assertFalse(state["programRunning"])

    def test_manual_settings_stop_program_and_persist_stop(self):
        self.request("/api/program", program())
        self.assertTrue(self.request("/api/state")[1]["programRunning"])
        settings = {"character": "turtle", "emotion": "love", "view": "auto"}
        self.assertEqual(self.request("/api/settings", settings)[0], 200)
        state = self.request("/api/state")[1]
        self.assertFalse(state["program"]["enabled"])
        self.assertFalse(state["programRunning"])
        self.assertEqual(state["rendered"], settings)
        self.request("/api/debug/reboot", {})
        self.assertEqual(self.request("/api/state")[1]["rendered"], settings)

    def test_reset_clears_saved_program(self):
        self.request("/api/program", program())
        self.assertEqual(self.request("/api/reset", {})[0], 200)
        state = self.request("/api/state")[1]
        self.assertIsNone(state["program"])
        self.assertFalse(state["programRunning"])
        self.request("/api/debug/reboot", {})
        self.assertIsNone(self.request("/api/state")[1]["program"])

    def test_invalid_program_preserves_settings_and_last_program(self):
        base = {"character": "bear", "emotion": "sleepy", "view": "auto"}
        self.request("/api/settings", base)
        saved = program()
        self.request("/api/program", saved)
        invalid = []
        for block in [
            {"type": "unknown"}, {"op": "weather"},
            {"type": "character", "value": "dragon"},
            {"type": "emotion", "value": "fear"},
            {"type": "weather", "extra": True},
            {"type": "wait", "ms": True}, {"type": "wait", "ms": 100.0},
            {"type": "wait", "ms": 99}, {"type": "wait", "ms": 30001},
            {"type": "repeat", "count": 21, "blocks": []},
            {"type": "repeat", "count": 0, "blocks": []},
            {"type": "repeat", "count": True, "blocks": []},
            {"type": "repeat", "count": 1, "blocks": "not a list"},
            {"type": "ifWeather", "kind": "storm", "then": [], "else": []},
            {"type": "ifWeather", "kind": "sun", "then": [], "else": {}, "extra": 1},
        ]:
            value = program()
            value["blocks"] = [block]
            invalid.append(value)
        too_deep = {"type": "weather"}
        for _ in range(4):
            too_deep = {"type": "repeat", "count": 1, "blocks": [too_deep]}
        invalid += [{**program(), "blocks": [too_deep]},
                    {**program(), "blocks": [{"type": "weather"}] * 65},
                    {**program(), "blocks": []}, {**program(), "unknown": 1},
                    {**program(), "schema": True}, {**program(), "schema": 1.0},
                    {**program(), "enabled": 1}, {**program(), "loop": "yes"}]
        for candidate in invalid:
            with self.subTest(candidate=candidate):
                self.assertEqual(self.request("/api/program", candidate)[0], 400)
                state = self.request("/api/state")[1]
                self.assertEqual(state["program"], saved)
                self.assertEqual({key: state[key] for key in base}, base)
                self.assertTrue(state["programRunning"])

    def test_program_body_limit_is_atomic(self):
        saved = program()
        self.request("/api/program", saved)
        candidate = {**program(), "padding": "x" * dev.MAX_BODY_BYTES}
        self.assertEqual(self.request("/api/program", candidate)[0], 413)
        self.assertEqual(self.request("/api/state")[1]["program"], saved)

    def test_invalid_control_and_invalid_manual_settings_keep_program(self):
        self.assertEqual(self.request("/api/program/control", {"action": "start"})[0], 400)
        saved = program()
        self.request("/api/program", saved)
        for control in ({"action": "pause"}, {"action": "start", "extra": 1}, {}):
            self.assertEqual(self.request("/api/program/control", control)[0], 400)
        self.assertEqual(self.request("/api/settings", {"character": "dragon", "emotion": "happy", "view": "character"})[0], 400)
        state = self.request("/api/state")[1]
        self.assertEqual(state["program"], saved)
        self.assertTrue(state["programRunning"])

    def test_nested_empty_blocks_are_valid(self):
        candidate = {"schema": 1, "enabled": True, "loop": False, "blocks": [
            {"type": "repeat", "count": 20, "blocks": []},
            {"type": "ifWeather", "kind": "sun", "then": [], "else": []},
        ]}
        self.assertEqual(self.request("/api/program", candidate)[0], 200)

    def test_cross_origin_program_is_not_saved(self):
        self.assertEqual(self.request("/api/program", program(), {"Origin": "https://other.example"})[0], 403)
        self.assertIsNone(self.request("/api/state")[1]["program"])

    def test_reject_cross_origin_writes(self):
        self.assertEqual(self.request("/api/reset", {}, {"Origin": "https://other.example"})[0], 403)

    def test_static_server_has_no_simulated_api_by_default(self):
        saved = self.server.device
        try:
            self.server.device = None
            self.assertEqual(self.request("/api/state")[0], 404)
        finally:
            self.server.device = saved


class SimulatedVM(unittest.TestCase):
    def device(self, blocks, loop=False):
        device = dev.MockDevice()
        device.program = dev.validate_program({"schema": 1, "enabled": True, "loop": loop, "blocks": blocks})
        device.start_program(0)
        return device

    def test_wait_deadline_and_finite_finish_hold_last_output(self):
        device = self.device([{"type": "character", "value": "cat"},
                              {"type": "wait", "ms": 500},
                              {"type": "emotion", "value": "love"}])
        device.tick_program(1000)
        self.assertEqual(device.rendered["character"], "cat")
        self.assertEqual(device.rendered["emotion"], "happy")
        device.tick_program(1499)
        self.assertEqual(device.rendered["emotion"], "happy")
        device.tick_program(1500)
        self.assertEqual(device.rendered["emotion"], "love")
        self.assertFalse(device.program_running)
        self.assertTrue(device.program["enabled"])
        device.stop_program()
        self.assertEqual(device.rendered["character"], "rabbit")

    def test_repeat_is_bounded_and_resumes_after_wait(self):
        device = self.device([{"type": "repeat", "count": 3, "blocks": [
            {"type": "emotion", "value": "angry"}, {"type": "wait", "ms": 100}]},
            {"type": "emotion", "value": "happy"}])
        for now in (0, 100, 200):
            device.tick_program(now)
            self.assertTrue(device.program_running)
            self.assertEqual(device.rendered["emotion"], "angry")
        device.tick_program(300)
        self.assertFalse(device.program_running)
        self.assertEqual(device.rendered["emotion"], "happy")

    def test_weather_conditions_cached_and_missing(self):
        for code, expected in ((0, "sun"), (48, "cloud"), (95, "rain"), (85, "snow")):
            with self.subTest(code=code):
                device = self.device([{"type": "ifWeather", "kind": expected,
                    "then": [{"type": "emotion", "value": "love"}],
                    "else": [{"type": "emotion", "value": "sad"}]}])
                device.weather = sample("sample")
                device.weather["current"]["code"] = code
                device.tick_program(0)
                self.assertEqual(device.rendered["emotion"], "love")
        device = self.device([{"type": "ifWeather", "kind": "sun", "then": [],
                              "else": [{"type": "weather"}]}])
        device.tick_program(0)
        self.assertEqual(device.rendered["view"], "weather")

    def test_waitless_loop_yields_and_budget_limits_empty_nested_repeats(self):
        device = self.device([{"type": "emotion", "value": "love"}], loop=True)
        device.tick_program(1000)
        self.assertEqual(device.deadline_ms, 1100)
        self.assertTrue(device.program_running)
        device.tick_program(1099)
        self.assertEqual(device.deadline_ms, 1100)
        device.tick_program(1100)
        self.assertEqual(device.deadline_ms, 1200)
        nested = {"type": "repeat", "count": 20, "blocks": []}
        for _ in range(3):
            nested = {"type": "repeat", "count": 20, "blocks": [nested]}
        device = self.device([nested, {"type": "emotion", "value": "love"}])
        device.tick_program(0)
        self.assertTrue(device.program_running)
        self.assertEqual(device.rendered["emotion"], "happy")
        self.assertLessEqual(len(device.frames), 4)

    def test_empty_containers_consume_one_step_each(self):
        blocks = [{"type": "repeat", "count": 20, "blocks": []}] * 15
        blocks.append({"type": "emotion", "value": "love"})
        device = self.device(blocks)
        device.tick_program(0)
        self.assertEqual(device.rendered["emotion"], "love")
        self.assertTrue(device.program_running)  # Root completion consumes the next step.
        device.tick_program(1)
        self.assertFalse(device.program_running)

    def test_backward_monotonic_clock_stops_to_saved_base(self):
        device = self.device([{"type": "emotion", "value": "love"}, {"type": "wait", "ms": 100}])
        device.tick_program(1000)
        self.assertEqual(device.rendered["emotion"], "love")
        device.tick_program(999)
        self.assertFalse(device.program_running)
        self.assertEqual(device.rendered["emotion"], "happy")


if __name__ == "__main__":
    unittest.main()
