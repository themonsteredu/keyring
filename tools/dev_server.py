#!/usr/bin/env python3
"""Static editor; --mock adds a visibly simulated API, never real hardware."""
import argparse
import copy
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
CHARACTERS = ("rabbit", "cat", "bear", "turtle", "monster")
EMOTIONS = ("happy", "excited", "sleepy", "sad", "angry", "love")
VIEWS = ("character", "weather", "auto")
CODES = (0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67,
         71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99)
MIN_EPOCH, MAX_EPOCH = 1704067200, 4102444800
MAX_BODY_BYTES = 16 * 1024
WEATHER_KINDS = ("sun", "cloud", "rain", "snow")


def number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def epoch(value):
    return type(value) is int and MIN_EPOCH <= value < MAX_EPOCH


def validate_weather(data):
    if not isinstance(data, dict) or type(data.get("schema")) is not int or data["schema"] != 1:
        raise ValueError("예보 형식(schema)이 올바르지 않아요.")
    if data.get("source") not in ("open-meteo", "sample") or not epoch(data.get("fetchedAt")):
        raise ValueError("예보 출처 또는 기준 시각을 확인해 주세요.")
    loc = data.get("location")
    if not isinstance(loc, dict) or not isinstance(loc.get("name"), str) or not loc["name"].strip() or not 1 <= len(loc["name"].encode()) <= 96 or any(ord(c) < 32 or ord(c) == 127 for c in loc["name"]):
        raise ValueError("지역 이름을 확인해 주세요.")
    for key, bound in (("latitude", 90), ("longitude", 180)):
        if not number(loc.get(key)) or not -bound <= loc[key] <= bound:
            raise ValueError("위도·경도를 확인해 주세요.")
    def point(item):
        return (isinstance(item, dict) and epoch(item.get("time")) and
                number(item.get("temperature")) and -90 <= item["temperature"] <= 65 and
                type(item.get("code")) is int and item["code"] in CODES and
                ("humidity" not in item or
                 (type(item["humidity"]) is int and 0 <= item["humidity"] <= 100)))
    if not point(data.get("current")) or not -3600 <= data["current"]["time"] - data["fetchedAt"] <= 300:
        raise ValueError("현재 날씨 시각·온도·코드를 확인해 주세요.")
    hourly = data.get("hourly")
    if not isinstance(hourly, list) or len(hourly) != 24 or not all(point(p) for p in hourly):
        raise ValueError("24개의 시간별 예보가 필요해요.")
    if abs(hourly[0]["time"] - data["fetchedAt"]) > 3600:
        raise ValueError("예보 기준 시각이 맞지 않아요.")
    if any(b["time"] - a["time"] != 3600 for a, b in zip(hourly, hourly[1:])):
        raise ValueError("예보는 한 시간 간격이어야 해요.")
    return copy.deepcopy(data)


def validate_program(data):
    """Validate the same bounded, declarative block format as the real device.

    This is a simulated API adapter; native firmware/JavaScript VM tests remain
    the authority for the physical device and browser execution respectively.
    """
    if not isinstance(data, dict) or set(data) != {"schema", "enabled", "loop", "blocks"}:
        raise ValueError("프로그램 형식의 필수 항목을 확인해 주세요.")
    if type(data["schema"]) is not int or data["schema"] != 1:
        raise ValueError("지원하지 않는 프로그램 버전이에요.")
    if type(data["enabled"]) is not bool or type(data["loop"]) is not bool:
        raise ValueError("프로그램 실행 설정이 올바르지 않아요.")
    if not isinstance(data["blocks"], list) or not data["blocks"]:
        raise ValueError("프로그램에 블록이 하나 이상 필요해요.")
    nodes = 0

    def visit(blocks, depth):
        nonlocal nodes
        if not isinstance(blocks, list):
            raise ValueError("블록 목록을 확인해 주세요.")
        if blocks and depth > 4:
            raise ValueError("블록은 4단계까지만 넣을 수 있어요.")
        for block in blocks:
            nodes += 1
            if nodes > 64:
                raise ValueError("블록은 64개까지 사용할 수 있어요.")
            if not isinstance(block, dict):
                raise ValueError("블록 형식을 확인해 주세요.")
            kind = block.get("type")
            if kind in ("character", "emotion"):
                choices = CHARACTERS if kind == "character" else EMOTIONS
                if set(block) != {"type", "value"} or block["value"] not in choices:
                    raise ValueError("캐릭터 또는 감정 블록 값을 확인해 주세요.")
            elif kind == "wait":
                if set(block) != {"type", "ms"} or type(block["ms"]) is not int or not 100 <= block["ms"] <= 30000:
                    raise ValueError("기다리기는 100~30000밀리초의 정수로 정해 주세요.")
            elif kind == "weather":
                if set(block) != {"type"}:
                    raise ValueError("날씨 표시 블록의 형식을 확인해 주세요.")
            elif kind == "repeat":
                if set(block) != {"type", "count", "blocks"} or type(block["count"]) is not int or not 1 <= block["count"] <= 20:
                    raise ValueError("반복 횟수는 1~20의 정수로 정해 주세요.")
                visit(block["blocks"], depth + 1)
            elif kind == "ifWeather":
                if set(block) != {"type", "kind", "then", "else"} or block["kind"] not in WEATHER_KINDS:
                    raise ValueError("날씨 조건 블록의 형식을 확인해 주세요.")
                visit(block["then"], depth + 1)
                visit(block["else"], depth + 1)
            else:
                raise ValueError("알 수 없는 블록이에요.")

    visit(data["blocks"], 1)
    return copy.deepcopy(data)


def weather_kind(code):
    if code in (0, 1):
        return "sun"
    if code in (2, 3, 45, 48):
        return "cloud"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    return "rain"


class MockDevice:
    def __init__(self):
        self.lock = threading.Lock()
        self.clock_base = None
        self.monotonic_base = time.monotonic()
        self.reset()

    def reset(self):
        self.character, self.emotion, self.view = "rabbit", "happy", "character"
        self.weather = None
        self.program = None
        self.stop_program()

    def stop_program(self):
        self.program_running = False
        self.frames = []
        self.deadline_ms = 0
        self.last_tick_ms = 0
        self.rendered = {"character": self.character, "emotion": self.emotion, "view": self.view}

    def start_program(self, now_ms=None):
        self.stop_program()
        self.last_tick_ms = int(time.monotonic() * 1000) if now_ms is None else now_ms
        if self.program is not None and self.program["enabled"]:
            self.frames = [{"blocks": self.program["blocks"], "index": 0, "remaining": 1}]
            self.program_running = True

    def tick_program(self, now_ms=None):
        """Advance the explicitly simulated VM with a strict 16-step budget.

        Called on state reads rather than a hardware loop. Waits use monotonic
        deadlines; a delayed HTTP request never replays missed real-time frames.
        """
        now_ms = int(time.monotonic() * 1000) if now_ms is None else now_ms
        if not self.program_running:
            return
        if now_ms < self.last_tick_ms:
            self.stop_program()
            return
        self.last_tick_ms = now_ms
        if now_ms < self.deadline_ms:
            return
        for _ in range(16):
            frame = self.frames[-1]
            if frame["index"] >= len(frame["blocks"]):
                if frame["remaining"] > 1:
                    frame["remaining"] -= 1
                    frame["index"] = 0
                    continue
                self.frames.pop()
                if self.frames:
                    continue
                if not self.program["loop"]:
                    self.program_running = False
                    return
                self.frames = [{"blocks": self.program["blocks"], "index": 0, "remaining": 1}]
                self.deadline_ms = now_ms + 100
                return
            block = frame["blocks"][frame["index"]]
            frame["index"] += 1
            kind = block["type"]
            if kind in ("character", "emotion"):
                self.rendered[kind] = block["value"]
                self.rendered["view"] = "character"
            elif kind == "weather":
                self.rendered["view"] = "weather"
            elif kind == "wait":
                self.deadline_ms = now_ms + block["ms"]
                return
            elif kind == "repeat":
                if block["blocks"]:
                    self.frames.append({"blocks": block["blocks"], "index": 0, "remaining": block["count"]})
            elif kind == "ifWeather":
                current_kind = weather_kind(self.weather["current"]["code"]) if self.weather else None
                branch = block["then"] if current_kind == block["kind"] else block["else"]
                if branch:
                    self.frames.append({"blocks": branch, "index": 0, "remaining": 1})

    def reboot(self):
        self.clock_base = None
        self.monotonic_base = time.monotonic()
        self.start_program()

    def now(self):
        return None if self.clock_base is None else self.clock_base + int(time.monotonic() - self.monotonic_base)

    def state(self):
        self.tick_program()
        now = self.now()
        status = "missing"
        if self.weather:
            w = self.weather
            if w["source"] == "sample":
                status = "sample"
            elif now is None:
                status = "clock-unknown"
            elif now + 300 < w["fetchedAt"] or now - w["fetchedAt"] > 10800 or now + 3600 < w["hourly"][0]["time"] or now >= w["hourly"][-1]["time"] + 3600:
                status = "stale"
            else:
                status = "fresh"
        return {"character": self.character, "emotion": self.emotion, "view": self.view,
                "ssid": "개발용 모의 키링", "simulated": True, "oled": True, "storage": True,
                "firmware": "2.2.0-mock", "capabilities": {"blockPrograms": True},
                "clock": {"trusted": now is not None, "now": now},
                "weather": self.weather, "weatherStatus": status,
                "program": self.program, "programRunning": self.program_running,
                "rendered": self.rendered}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def reply(self, code, payload):
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        if self.path.startswith("/api/"):
            if self.server.device and self.path == "/api/state":
                with self.server.device.lock:
                    return self.reply(200, self.server.device.state())
            return self.reply(404, {"ok": False, "error": "기기가 연결되지 않았어요."})
        return super().do_GET()

    def do_POST(self):
        if not self.server.device:
            return self.reply(404, {"ok": False, "error": "기기가 연결되지 않았어요."})
        if self.headers.get("Origin") not in (None, "http://" + self.headers.get("Host", "")):
            return self.reply(403, {"ok": False, "error": "다른 사이트의 요청은 허용하지 않아요."})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.reply(415, {"ok": False, "error": "JSON 형식이 필요해요."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                return self.reply(413, {"ok": False, "error": "요청 크기를 확인해 주세요."})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("설정 객체가 필요해요.")
            d = self.server.device
            with d.lock:
                if self.path == "/api/settings":
                    if data.get("character") not in CHARACTERS or data.get("emotion") not in EMOTIONS or data.get("view") not in VIEWS:
                        raise ValueError("캐릭터·감정·화면을 확인해 주세요.")
                    d.character, d.emotion, d.view = data["character"], data["emotion"], data["view"]
                    if d.program is not None:
                        d.program["enabled"] = False
                    d.stop_program()
                elif self.path == "/api/program":
                    candidate = validate_program(data)
                    d.program = candidate
                    d.start_program()
                elif self.path == "/api/program/control":
                    if set(data) != {"action"} or data["action"] not in ("start", "stop"):
                        raise ValueError("프로그램 시작 또는 멈추기를 골라 주세요.")
                    if d.program is None:
                        raise ValueError("프로그램을 먼저 저장해 주세요.")
                    d.program["enabled"] = data["action"] == "start"
                    if d.program["enabled"]:
                        d.start_program()
                    else:
                        d.stop_program()
                elif self.path == "/api/time":
                    if not epoch(data.get("epoch")):
                        raise ValueError("기준 시각을 확인해 주세요.")
                    d.clock_base, d.monotonic_base = data["epoch"], time.monotonic()
                elif self.path == "/api/weather":
                    candidate = validate_weather(data)
                    if d.now() is not None and candidate["fetchedAt"] > d.now() + 300:
                        raise ValueError("미래 시각의 예보는 저장할 수 없어요.")
                    d.weather = candidate
                elif self.path == "/api/reset":
                    d.reset()
                elif self.path == "/api/debug/reboot":
                    # Test-only simulated power cycle; no hardware fidelity claim.
                    d.reboot()
                else:
                    return self.reply(404, {"ok": False, "error": "알 수 없는 요청이에요."})
            return self.reply(200, {"ok": True, "saved": self.path != "/api/time"})
        except (ValueError, UnicodeError, RecursionError) as exc:
            return self.reply(400, {"ok": False, "error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--mock", action="store_true", help="simulate API; not connected hardware")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.device = MockDevice() if args.mock else None
    print(f"Keyring web on port {server.server_port}; {'SIMULATED DEVICE' if args.mock else 'static, no device'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
