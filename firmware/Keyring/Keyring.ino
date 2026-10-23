// ESP32-C3 SuperMini / ESP32C3 Dev Module, Arduino ESP32 core 3.3.7.
// Confirmed wiring: OLED GND->G, VCC->3.3V, SDA->GPIO4, SCL->GPIO5.
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <esp_timer.h>
#include <time.h>
#include <initializer_list>

#include "keyring_core.h"
#include "character_renderer.h"
#include "web_assets.h"

static constexpr uint8_t kSdaPin = 4;
static constexpr uint8_t kSclPin = 5;
static constexpr uint32_t kI2cHz = 400000;
static constexpr size_t kMaxBody = 10240;
static constexpr uint32_t kFrameMs = 160;
static constexpr char kApPassword[] = "keyring123";
static constexpr char kNvsNamespace[] = "keyring-s1";

Adafruit_SSD1306 display(128, 64, &Wire, -1, kI2cHz, kI2cHz);
WebServer server(80);
DNSServer dns;
Preferences storage;
keyring_core::Settings settings;
keyring_core::Weather weather;
keyring_core::Clock deviceClock;
keyring::FrameBuffer characterFrame;
uint8_t lastDisplay[1024];
bool displaySent = false;
bool oledReady = false;
bool storageReady = false;
bool haveWeather = false;
String accessPointName;
uint64_t lastFrameMs = 0;

static uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }

static void sendJson(int status, const JsonDocument& document) {
  String body;
  serializeJson(document, body);
  server.sendHeader("Cache-Control", "no-store");
  server.sendHeader("X-Content-Type-Options", "nosniff");
  server.send(status, "application/json; charset=utf-8", body);
}

static void sendError(int status, const char* message) {
  JsonDocument document;
  document["ok"] = false;
  document["error"] = message;
  sendJson(status, document);
}

static void sendSaved() {
  JsonDocument document;
  document["ok"] = true;
  document["saved"] = true;
  sendJson(200, document);
}

static bool readJson(JsonDocument& document) {
  // The API is a local, same-origin AP API. Refuse browser cross-site writes.
  const String host = server.hostHeader();
  const String origin = server.header("Origin");
  if ((host != "192.168.4.1" && host != "192.168.4.1:80") ||
      (origin.length() && origin != "http://192.168.4.1" && origin != "http://192.168.4.1:80")) {
    sendError(403, "same_origin_required");
    return false;
  }
  String contentType = server.header("Content-Type");
  const int separator = contentType.indexOf(';');
  if (separator >= 0) contentType = contentType.substring(0, separator);
  contentType.trim();
  contentType.toLowerCase();
  if (contentType != "application/json") {
    sendError(415, "application_json_required");
    return false;
  }
  if (!server.hasArg("plain") || server.arg("plain").length() == 0) {
    sendError(400, "json_body_required");
    return false;
  }
  if (server.arg("plain").length() > kMaxBody) {
    sendError(413, "body_too_large");
    return false;
  }
  const DeserializationError error = deserializeJson(document, server.arg("plain"), DeserializationOption::NestingLimit(7));
  if (error || !document.is<JsonObject>()) {
    sendError(400, "invalid_json");
    return false;
  }
  return true;
}

static bool parsePoint(JsonVariantConst input, keyring_core::ForecastPoint& output) {
  if (!input.is<JsonObjectConst>() || !input["time"].is<uint32_t>() ||
      !input["temperature"].is<float>() || !input["code"].is<int>()) return false;
  const int code = input["code"].as<int>();
  if (!keyring_core::validWeatherCode(code)) return false;
  output.time = input["time"].as<uint32_t>();
  output.temperature = input["temperature"].as<float>();
  output.code = static_cast<int16_t>(code);
  return keyring_core::validPoint(output);
}

static bool parseWeather(JsonVariantConst input, keyring_core::Weather& output) {
  if (!input.is<JsonObjectConst>() || !input["schema"].is<int>() ||
      input["schema"].as<int>() != keyring_core::kSchema || !input["source"].is<const char*>() ||
      !input["fetchedAt"].is<uint32_t>() || !input["location"].is<JsonObjectConst>()) return false;
  const char* source = input["source"].as<const char*>();
  if (strcmp(source, "open-meteo") == 0) output.source = keyring_core::WeatherSource::OpenMeteo;
  else if (strcmp(source, "sample") == 0) output.source = keyring_core::WeatherSource::Sample;
  else return false;
  const JsonVariantConst location = input["location"];
  if (!location["name"].is<const char*>() || !location["latitude"].is<float>() || !location["longitude"].is<float>()) return false;
  const char* locationName = location["name"].as<const char*>();
  const size_t length = strlen(locationName);
  if (!length || length > keyring_core::kLocationBytes) return false;
  for (size_t i = 0; i < length; ++i) if (static_cast<unsigned char>(locationName[i]) < 32) return false;
  memcpy(output.location, locationName, length + 1);
  output.latitude = location["latitude"].as<float>();
  output.longitude = location["longitude"].as<float>();
  output.fetchedAt = input["fetchedAt"].as<uint32_t>();
  if (!parsePoint(input["current"], output.current)) return false;
  const JsonArrayConst hours = input["hourly"].as<JsonArrayConst>();
  if (hours.size() != keyring_core::kHours) return false;
  for (size_t i = 0; i < keyring_core::kHours; ++i) if (!parsePoint(hours[i], output.hourly[i])) return false;
  return keyring_core::validWeather(output);
}

static void appendPoint(JsonObject object, const keyring_core::ForecastPoint& point) {
  object["time"] = point.time;
  object["temperature"] = point.temperature;
  object["code"] = point.code;
}

static void appendWeather(JsonObject object, const keyring_core::Weather& value) {
  object["schema"] = keyring_core::kSchema;
  object["source"] = value.source == keyring_core::WeatherSource::Sample ? "sample" : "open-meteo";
  object["fetchedAt"] = value.fetchedAt;
  JsonObject location = object["location"].to<JsonObject>();
  location["name"] = value.location;
  location["latitude"] = value.latitude;
  location["longitude"] = value.longitude;
  appendPoint(object["current"].to<JsonObject>(), value.current);
  JsonArray hourly = object["hourly"].to<JsonArray>();
  for (size_t i = 0; i < keyring_core::kHours; ++i) appendPoint(hourly.add<JsonObject>(), value.hourly[i]);
}

static String settingsJson(const keyring_core::Settings& value) {
  JsonDocument document;
  document["schema"] = keyring_core::kSchema;
  document["character"] = keyring_core::kCharacters[value.character];
  document["emotion"] = keyring_core::kEmotions[value.emotion];
  document["view"] = keyring_core::kViews[value.view];
  String result;
  serializeJson(document, result);
  return result;
}

static bool persistString(const char* key, const String& value) {
  if (!storageReady) return false;
  // Do not wear flash out when students press Apply repeatedly without changes.
  if (storage.getString(key, "") == value) return true;
  return storage.putString(key, value) == value.length();
}

static void restoreData() {
  storageReady = storage.begin(kNvsNamespace, false);
  if (!storageReady) { Serial.println("NVS open failed: read-only UI until storage is available"); return; }
  JsonDocument document;
  const String savedSettings = storage.getString("settings", "");
  if (savedSettings.length() && savedSettings.length() < 512 && !deserializeJson(document, savedSettings) &&
      document["schema"].is<int>() && document["schema"].as<int>() == keyring_core::kSchema) {
    keyring_core::Settings restored;
    if (keyring_core::parseSettings(document["character"].as<const char*>(), document["emotion"].as<const char*>(),
                                    document["view"].as<const char*>(), restored)) settings = restored;
  }
  document.clear();
  const String savedWeather = storage.getString("weather", "");
  if (savedWeather.length() && savedWeather.length() <= kMaxBody && !deserializeJson(document, savedWeather)) {
    haveWeather = parseWeather(document.as<JsonVariantConst>(), weather);
  }
  // deviceClock is intentionally NOT restored. The C3 has no battery-backed RTC.
  Serial.printf("Loaded character=%s emotion=%s view=%s weather=%s; clock is unknown until phone synchronization\n",
                keyring_core::kCharacters[settings.character], keyring_core::kEmotions[settings.emotion],
                keyring_core::kViews[settings.view], haveWeather ? "cached" : "none");
}

static void stateRequest() {
  const uint64_t nowMs = uptimeMs();
  JsonDocument document;
  document["ok"] = true;
  document["character"] = keyring_core::kCharacters[settings.character];
  document["emotion"] = keyring_core::kEmotions[settings.emotion];
  document["view"] = keyring_core::kViews[settings.view];
  document["ssid"] = accessPointName;
  document["oled"] = oledReady;
  document["storage"] = storageReady;
  document["firmware"] = "1.0.0";
  JsonObject clock = document["clock"].to<JsonObject>();
  clock["trusted"] = deviceClock.trusted(nowMs);
  if (deviceClock.trusted(nowMs)) clock["now"] = deviceClock.now(nowMs);
  else clock["now"] = nullptr;
  document["weatherStatus"] = keyring_core::statusName(keyring_core::weatherStatus(haveWeather ? &weather : nullptr, deviceClock, nowMs));
  if (haveWeather) appendWeather(document["weather"].to<JsonObject>(), weather);
  else document["weather"] = nullptr;
  sendJson(200, document);
}

static void settingsRequest() {
  JsonDocument document;
  if (!readJson(document)) return;
  keyring_core::Settings next;
  if (!document["character"].is<const char*>() || !document["emotion"].is<const char*>() || !document["view"].is<const char*>() ||
      !keyring_core::parseSettings(document["character"].as<const char*>(), document["emotion"].as<const char*>(),
                                  document["view"].as<const char*>(), next)) {
    sendError(422, "invalid_settings"); return;
  }
  if (!persistString("settings", settingsJson(next))) { sendError(503, "storage_write_failed"); return; }
  settings = next;
  sendSaved();
}

static void timeRequest() {
  JsonDocument document;
  if (!readJson(document)) return;
  if (!document["epoch"].is<uint32_t>() || !deviceClock.synchronize(document["epoch"].as<uint32_t>(), uptimeMs())) {
    sendError(422, "invalid_epoch"); return;
  }
  JsonDocument response;
  response["ok"] = true;
  sendJson(200, response);
}

static void weatherRequest() {
  JsonDocument document;
  if (!readJson(document)) return;
  keyring_core::Weather next;
  if (!parseWeather(document.as<JsonVariantConst>(), next)) { sendError(422, "invalid_weather"); return; }
  // A bad phone clock must not turn a future-dated payload into live weather.
  if (deviceClock.trusted(uptimeMs()) && static_cast<uint64_t>(next.fetchedAt) > static_cast<uint64_t>(deviceClock.now(uptimeMs())) + 300) {
    sendError(422, "weather_from_future"); return;
  }
  JsonDocument normalized;
  appendWeather(normalized.to<JsonObject>(), next);
  String canonical;
  serializeJson(normalized, canonical);
  if (!persistString("weather", canonical)) { sendError(503, "storage_write_failed"); return; }
  weather = next;
  haveWeather = true;
  sendSaved();
}

static void resetRequest() {
  JsonDocument document;
  if (!readJson(document)) return;
  if (!storageReady || !storage.clear()) { sendError(503, "storage_write_failed"); return; }
  settings = keyring_core::Settings();
  weather = keyring_core::Weather();
  haveWeather = false;
  sendSaved();
}

static void assetRequest() {
  const String path = server.uri() == "/" ? "/index.html" : server.uri();
  for (size_t i = 0; i < web_assets::assetCount; ++i) {
    const web_assets::Asset& asset = web_assets::assets[i];
    if (path == asset.path) {
      server.sendHeader("Content-Encoding", "gzip");
      server.sendHeader("Cache-Control", "no-cache");
      server.sendHeader("X-Content-Type-Options", "nosniff");
      server.sendHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      server.send_P(200, asset.type, reinterpret_cast<const char*>(asset.data), asset.size);
      return;
    }
  }
  if (path.startsWith("/api/")) { sendError(404, "not_found"); return; }
  // Captive portal probes need the canonical AP URL before performing writes.
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "Open http://192.168.4.1/");
}

static void printKst(uint32_t epoch, char* output, size_t length, const char* format) {
  const time_t shifted = static_cast<time_t>(epoch) + 9 * 3600;
  struct tm value;
  gmtime_r(&shifted, &value);
  strftime(output, length, format, &value);
}

static void drawIcon(int x, int y, keyring_core::Icon icon, bool small) {
  const int r = small ? 3 : 8;
  const int cx = x + (small ? 5 : 14);
  const int cy = y + (small ? 5 : 14);
  if (icon == keyring_core::Icon::Sun) {
    display.drawCircle(cx, cy, r, SSD1306_WHITE);
    for (int a = 0; a < 8; ++a) {
      const float angle = a * PI / 4;
      display.drawLine(cx + cosf(angle) * (r + 2), cy + sinf(angle) * (r + 2),
                       cx + cosf(angle) * (r + 4), cy + sinf(angle) * (r + 4), SSD1306_WHITE);
    }
    return;
  }
  const int w = small ? 10 : 29;
  const int h = small ? 5 : 12;
  display.fillRoundRect(x, y + (small ? 2 : 5), w, h, small ? 2 : 5, SSD1306_WHITE);
  display.fillCircle(x + w / 3, y + (small ? 3 : 7), small ? 3 : 7, SSD1306_WHITE);
  display.fillCircle(x + 2 * w / 3, y + (small ? 2 : 4), small ? 2 : 6, SSD1306_WHITE);
  const int bottom = y + (small ? 9 : 23);
  if (icon == keyring_core::Icon::Rain) {
    display.drawLine(x + 2, bottom, x, bottom + (small ? 2 : 5), SSD1306_WHITE);
    display.drawLine(x + w / 2, bottom, x + w / 2 - 2, bottom + (small ? 2 : 5), SSD1306_WHITE);
    display.drawLine(x + w - 2, bottom, x + w - 4, bottom + (small ? 2 : 5), SSD1306_WHITE);
  } else if (icon == keyring_core::Icon::Snow) {
    display.drawFastHLine(x + w / 2 - 2, bottom + 1, 5, SSD1306_WHITE);
    display.drawFastVLine(x + w / 2, bottom - 1, 5, SSD1306_WHITE);
    if (!small) {
      display.drawLine(x + w / 2 - 2, bottom - 1, x + w / 2 + 2, bottom + 3, SSD1306_WHITE);
      display.drawLine(x + w / 2 + 2, bottom - 1, x + w / 2 - 2, bottom + 3, SSD1306_WHITE);
    }
  } else if (icon == keyring_core::Icon::Storm) {
    display.drawLine(x + w / 2 + 2, bottom - 2, x + w / 2 - 2, bottom + 2, SSD1306_WHITE);
    display.drawLine(x + w / 2 - 2, bottom + 2, x + w / 2 + 2, bottom + 2, SSD1306_WHITE);
    display.drawLine(x + w / 2 + 2, bottom + 2, x + w / 2 - 2, bottom + 6, SSD1306_WHITE);
  } else if (icon == keyring_core::Icon::Fog) {
    display.drawFastHLine(x, bottom, w, SSD1306_WHITE);
    display.drawFastHLine(x + 2, bottom + 3, w - 4, SSD1306_WHITE);
  }
}

static void weatherFrame(uint64_t nowMs, uint8_t page) {
  display.clearDisplay();  // RAM only; never send a cleared frame to the OLED.
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  display.print(keyring_core::oledStatus(keyring_core::weatherStatus(haveWeather ? &weather : nullptr, deviceClock, nowMs)));
  if (!haveWeather) {
    display.setCursor(0, 22); display.print("Connect phone Wi-Fi");
    display.setCursor(0, 34); display.print("192.168.4.1");
    display.setCursor(0, 48); display.print("Import weather JSON");
    return;
  }
  display.setCursor(104, 0);
  if (page) { display.print(page); display.print("/4"); }
  else display.print("NOW");
  char timestamp[24];
  printKst(weather.fetchedAt, timestamp, sizeof(timestamp), "UPD%y/%m/%d %H:%MK");
  display.setCursor(0, 10); display.print(timestamp);
  if (!page) {
    drawIcon(4, 26, keyring_core::weatherIcon(weather.current.code), false);
    display.setTextSize(2);
    display.setCursor(43, 28); display.print(weather.current.temperature, 1); display.print('C');
    display.setTextSize(1);
    printKst(weather.current.time, timestamp, sizeof(timestamp), "AT %m/%d %H:%M KST");
    display.setCursor(0, 55); display.print(timestamp);
    return;
  }
  const size_t start = static_cast<size_t>(page - 1) * 6;
  for (size_t cell = 0; cell < 6; ++cell) {
    const keyring_core::ForecastPoint& point = weather.hourly[start + cell];
    const int x = (cell % 2) * 64;
    const int y = 22 + (cell / 2) * 14;
    printKst(point.time, timestamp, sizeof(timestamp), "%H");
    display.setCursor(x, y); display.print(timestamp);
    display.setCursor(x + 14, y); display.print(static_cast<int>(roundf(point.temperature))); display.print('C');
    drawIcon(x + 48, y - 1, keyring_core::weatherIcon(point.code), true);
  }
}

static void updateDisplay(uint64_t nowMs) {
  if (!oledReady || (displaySent && nowMs - lastFrameMs < kFrameMs)) return;
  lastFrameMs = nowMs;
  bool showWeather = settings.view == 1;
  uint8_t page = (nowMs / 5000) % 5;
  if (settings.view == 2) {
    const uint32_t cycle = nowMs % 40000;
    showWeather = cycle >= 15000;
    page = showWeather ? static_cast<uint8_t>((cycle - 15000) / 5000) : 0;
  }
  if (showWeather) weatherFrame(nowMs, page);
  else {
    keyring::renderCharacter(characterFrame, settings.character, settings.emotion, (nowMs / kFrameMs) % 32);
    memcpy(display.getBuffer(), characterFrame.data, sizeof(lastDisplay));
  }
  if (!displaySent || memcmp(lastDisplay, display.getBuffer(), sizeof(lastDisplay)) != 0) {
    memcpy(lastDisplay, display.getBuffer(), sizeof(lastDisplay));
    display.display();
    displaySent = true;
  }
}

void setup() {
  Serial.begin(115200);
  // Do not wait for USB Serial: the keyring must also start from a USB charger.
  restoreData();
  Wire.begin(kSdaPin, kSclPin, kI2cHz);
  for (uint8_t address : {uint8_t(0x3C), uint8_t(0x3D)}) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0 && display.begin(SSD1306_SWITCHCAPVCC, address, false, false)) {
      oledReady = true;
      break;
    }
  }
  if (!oledReady) Serial.println("OLED not found at 0x3C/0x3D. Keep SDA=4 SCL=5; check GND/3.3V and wiring.");
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  uint8_t mac[6];
  WiFi.softAPmacAddress(mac);
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  accessPointName = String("Keyring-") + suffix;
  const IPAddress ip(192, 168, 4, 1);
  WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
  if (!WiFi.softAP(accessPointName.c_str(), kApPassword, 1, false, 4)) Serial.println("AP startup failed");
  dns.start(53, "*", ip);
  const char* headers[] = {"Origin", "Content-Type"};
  server.collectHeaders(headers, 2);
  server.on("/api/state", HTTP_GET, stateRequest);
  server.on("/api/settings", HTTP_POST, settingsRequest);
  server.on("/api/time", HTTP_POST, timeRequest);
  server.on("/api/weather", HTTP_POST, weatherRequest);
  server.on("/api/reset", HTTP_POST, resetRequest);
  server.onNotFound([]() {
    if (server.method() != HTTP_GET) { sendError(405, "method_not_allowed"); return; }
    assetRequest();
  });
  server.begin();
  Serial.printf("Keyring AP: %s, password: keyring123, settings: http://192.168.4.1/\n", accessPointName.c_str());
  updateDisplay(uptimeMs());
}

void loop() {
  dns.processNextRequest();
  server.handleClient();
  updateDisplay(uptimeMs());
  delay(1);  // Let the ESP32 Wi-Fi stack and idle task run.
}
