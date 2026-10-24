#pragma once

// Portable, black-and-white OLED weather view. Its pixels are also rendered by
// web/oled-weather.mjs; both use the same licensed Korean bitmap glyph subset.
#include <stdio.h>
#include "character_renderer.h"
#include "keyring_core.h"
#include "weather_glyphs.h"

namespace keyring {
namespace weather_detail {

inline uint32_t nextCodepoint(const char*& value) {
  const uint8_t first = static_cast<uint8_t>(*value++);
  if (first < 128) return first;
  const uint8_t second = static_cast<uint8_t>(*value++);
  if (first < 224) return ((first & 31u) << 6) | (second & 63u);
  const uint8_t third = static_cast<uint8_t>(*value++);
  return ((first & 15u) << 12) | ((second & 63u) << 6) | (third & 63u);
}

inline int text(FrameBuffer& b, const char* value, int x, int y, int scale = 1) {
  while (*value) {
    const uint32_t code = nextCodepoint(value);
    if (code == 32) { x += 4 * scale; continue; }
    for (size_t i = 0; i < sizeof(kGlyphs) / sizeof(kGlyphs[0]); ++i) {
      const Glyph& glyph = kGlyphs[i];
      if (glyph.code != code) continue;
      const int offset = code < 128 || code == 176 ? 2 : 0;
      for (int row = 0; row < 12; ++row)
        for (int col = 0; col < glyph.width; ++col)
          if (glyph.rows[row] & (1u << col))
            b.rectangle(x + col * scale, y + (row + offset) * scale, scale, scale);
      x += (glyph.width + 1) * scale;
      break;
    }
  }
  return x;
}

// Chunky filled shapes match the approved monochrome OLED design.
inline void stroke(FrameBuffer& b, int x0, int y0, int x1, int y1,
                   int thickness = 3, bool on = true) {
  for (int dy = 0; dy < thickness; ++dy)
    for (int dx = 0; dx < thickness; ++dx)
      b.line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, on);
}

inline void smile(FrameBuffer& b, int cx, int cy, bool blink) {
  // Happy closed eyes and a small smile are cut out of the white icon.
  for (int eye = -1; eye <= 1; eye += 2) {
    const int x = cx + eye * 7;
    if (blink) b.rectangle(x - 3, cy - 3, 7, 2, false);
    else {
      stroke(b, x - 3, cy - 2, x - 1, cy - 4, 2, false);
      stroke(b, x - 1, cy - 4, x + 1, cy - 4, 2, false);
      stroke(b, x + 1, cy - 4, x + 3, cy - 2, 2, false);
    }
  }
  stroke(b, cx - 4, cy + 3, cx - 2, cy + 5, 2, false);
  stroke(b, cx - 2, cy + 5, cx + 2, cy + 5, 2, false);
  stroke(b, cx + 2, cy + 5, cx + 4, cy + 3, 2, false);
}

inline void droplet(FrameBuffer& b, int x, int y) {
  b.triangle(x + 3, y, x, y + 6, x + 6, y + 6);
  b.ellipse(x + 3, y + 6, 3, 3);
}

inline void icon(FrameBuffer& b, int x, int y, keyring_core::Icon kind,
                 uint8_t phase) {
  const bool blink = phase == 14 || phase == 15;
  if (kind == keyring_core::Icon::Sun) {
    b.ellipse(x + 25, y + 22, 14, 14);
    b.rectangle(x + 23, y, 5, 5);
    b.rectangle(x + 23, y + 40, 5, 5);
    b.rectangle(x + 3, y + 20, 5, 5);
    b.rectangle(x + 43, y + 20, 5, 5);
    const int tilt = (phase / 8) % 2;
    stroke(b, x + 9, y + 6 + tilt, x + 12, y + 9 + tilt);
    stroke(b, x + 36, y + 33 - tilt, x + 39, y + 36 - tilt);
    stroke(b, x + 9, y + 36 - tilt, x + 12, y + 33 - tilt);
    stroke(b, x + 36, y + 9 + tilt, x + 39, y + 6 + tilt);
    smile(b, x + 25, y + 22, blink);
    return;
  }
  const int bob = (phase / 8) % 2;
  const int cy = y + bob;
  b.ellipse(x + 12, cy + 20, 10, 10);
  b.ellipse(x + 24, cy + 13, 13, 13);
  b.ellipse(x + 37, cy + 20, 11, 10);
  b.rectangle(x + 11, cy + 20, 27, 12);
  smile(b, x + 25, cy + 21, blink);
  if (kind == keyring_core::Icon::Rain) {
    const int fall = (phase / 8) % 2;
    for (int drop = 0; drop < 3; ++drop)
      droplet(b, x + 9 + drop * 12, y + 34 + fall);
  } else if (kind == keyring_core::Icon::Snow) {
    for (int flake = 0; flake < 2; ++flake) {
      const int cx = x + 15 + flake * 20;
      const int fy = y + 39 + (phase / 8) % 2;
      b.rectangle(cx - 4, fy - 1, 9, 3);
      b.rectangle(cx - 1, fy - 4, 3, 9);
      b.pixel(cx - 3, fy - 3); b.pixel(cx + 3, fy + 3);
      b.pixel(cx + 3, fy - 3); b.pixel(cx - 3, fy + 3);
    }
  } else if (kind == keyring_core::Icon::Storm) {
    b.triangle(x + 25, y + 33, x + 17, y + 39, x + 28, y + 39);
    b.triangle(x + 21, y + 37, x + 31, y + 37, x + 23, y + 45);
  } else if (kind == keyring_core::Icon::Fog) {
    b.rectangle(x + 5, y + 36, 32, 3);
    b.rectangle(x + 13, y + 42, 32, 3);
  }
}

inline const char* statusLabel(keyring_core::WeatherStatus status) {
  switch (status) {
    case keyring_core::WeatherStatus::Missing: return "날씨 없음";
    case keyring_core::WeatherStatus::Sample: return "연습 날씨";
    case keyring_core::WeatherStatus::ClockUnknown: return "시각 확인";
    case keyring_core::WeatherStatus::Stale: return "지난 예보";
    case keyring_core::WeatherStatus::Fresh: return "최근 날씨";
  }
  return "날씨 없음";
}

struct Date { unsigned month; unsigned day; unsigned hour; unsigned minute; };
inline Date kstDate(uint32_t epoch) {
  const uint64_t shifted = static_cast<uint64_t>(epoch) + 9 * 3600;
  unsigned days = static_cast<unsigned>(shifted / 86400);
  unsigned year = 1970;
  for (;;) {
    const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    const unsigned count = leap ? 366 : 365;
    if (days < count) break;
    days -= count; ++year;
  }
  const unsigned lengths[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  unsigned month = 0;
  for (; month < 11; ++month) {
    unsigned count = lengths[month];
    if (month == 1 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) ++count;
    if (days < count) break;
    days -= count;
  }
  Date result = {month + 1, days + 1, static_cast<unsigned>(shifted / 3600 % 24),
                 static_cast<unsigned>(shifted / 60 % 60)};
  return result;
}

}  // namespace weather_detail

// Page 0 is the received current weather; 1..24 are the stored hourly points.
// Only exceptional freshness states need a badge. The web details retain the
// received timestamp so the normal OLED stays icon + temperature + humidity.
inline void renderWeather(FrameBuffer& b, const keyring_core::Weather* weather,
                          keyring_core::WeatherStatus status, uint8_t page,
                          uint8_t phase = 0) {
  using namespace weather_detail;
  b.clear();
  if (!weather) {
    icon(b, 38, 3, keyring_core::Icon::Cloud, phase);
    text(b, "날씨 없음", 40, 50);
    return;
  }
  page %= 25;
  const keyring_core::ForecastPoint& point = page ? weather->hourly[page - 1] : weather->current;
  if (status != keyring_core::WeatherStatus::Fresh)
    text(b, statusLabel(status), 1, 0);
  char value[24];
  if (page) {
    const Date when = kstDate(point.time);
    snprintf(value, sizeof(value), "%02u/%02u %02u", when.month, when.day, when.hour);
    const int end = text(b, value, 69, 0);
    text(b, "시", end, 0);
  }
  icon(b, 2, 14, keyring_core::weatherIcon(point.code), phase);
  const int degrees = static_cast<int>(roundf(point.temperature));
  snprintf(value, sizeof(value), "%d", degrees);
  const int width = static_cast<int>(strlen(value)) * 18 + 5;
  const int x = 64 + (62 - width) / 2;
  const int end = text(b, value, x, 11, 3);
  text(b, "°", end, 12, 2);
  if (point.humidity < 0) snprintf(value, sizeof(value), "--%%");
  else snprintf(value, sizeof(value), "%d%%", point.humidity);
  const int humidityWidth = static_cast<int>(strlen(value)) * 12 - 2;
  const int humidityX = 64 + (62 - (humidityWidth + 11)) / 2;
  droplet(b, humidityX, 45);
  text(b, value, humidityX + 11, 39, 2);
}

}  // namespace keyring
