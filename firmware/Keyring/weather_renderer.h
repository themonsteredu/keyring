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

inline void boldLine(FrameBuffer& b, int x0, int y0, int x1, int y1, bool on = true) {
  b.line(x0, y0, x1, y1, on);
  b.line(x0, y0 + 1, x1, y1 + 1, on);
}

inline void smile(FrameBuffer& b, int cx, int cy, bool blink) {
  if (blink) {
    b.rectangle(cx - 7, cy - 2, 4, 2, false);
    b.rectangle(cx + 4, cy - 2, 4, 2, false);
  } else {
    b.ellipse(cx - 5, cy - 1, 1, 2, false);
    b.ellipse(cx + 6, cy - 1, 1, 2, false);
  }
  b.line(cx - 3, cy + 3, cx - 1, cy + 5, false);
  b.line(cx - 1, cy + 5, cx + 2, cy + 5, false);
  b.line(cx + 2, cy + 5, cx + 4, cy + 3, false);
}

inline void icon(FrameBuffer& b, int x, int y, keyring_core::Icon kind,
                 bool small, uint8_t phase) {
  if (small) {
    if (kind == keyring_core::Icon::Sun) {
      b.ellipse(x + 6, y + 5, 4, 4);
      b.line(x + 6, y - 1, x + 6, y);
      b.line(x + 6, y + 10, x + 6, y + 11);
      b.line(x, y + 5, x + 1, y + 5);
      b.line(x + 11, y + 5, x + 12, y + 5);
      b.pixel(x + 4, y + 4, false); b.pixel(x + 8, y + 4, false);
      b.line(x + 5, y + 7, x + 7, y + 7, false);
      return;
    }
    b.ellipse(x + 4, y + 4, 3, 3);
    b.ellipse(x + 8, y + 3, 3, 3);
    b.rectangle(x + 1, y + 4, 11, 3);
    b.pixel(x + 4, y + 4, false); b.pixel(x + 8, y + 4, false);
    if (kind == keyring_core::Icon::Rain) {
      b.line(x + 4, y + 9, x + 3, y + 10);
      b.line(x + 9, y + 9, x + 8, y + 10);
    } else if (kind == keyring_core::Icon::Snow) {
      b.pixel(x + 4, y + 9); b.pixel(x + 8, y + 10);
      b.pixel(x + 7, y + 8);
    } else if (kind == keyring_core::Icon::Storm) {
      b.line(x + 7, y + 8, x + 5, y + 10);
      b.line(x + 5, y + 10, x + 7, y + 10);
      b.pixel(x + 6, y + 11);
    } else if (kind == keyring_core::Icon::Fog) {
      b.line(x + 1, y + 9, x + 10, y + 9);
      b.line(x + 3, y + 11, x + 12, y + 11);
    }
    return;
  }

  const bool blink = phase == 14 || phase == 15;
  if (kind == keyring_core::Icon::Sun) {
    b.ellipse(x + 24, y + 17, 11, 11);
    boldLine(b, x + 24, y + 1, x + 24, y + 3);
    boldLine(b, x + 24, y + 31, x + 24, y + 33);
    boldLine(b, x + 8, y + 17, x + 10, y + 17);
    boldLine(b, x + 38, y + 17, x + 40, y + 17);
    const int tilt = (phase / 8) % 2;
    boldLine(b, x + 12, y + 5 + tilt, x + 14, y + 7 + tilt);
    boldLine(b, x + 34, y + 27 - tilt, x + 36, y + 29 - tilt);
    boldLine(b, x + 12, y + 29 - tilt, x + 14, y + 27 - tilt);
    boldLine(b, x + 34, y + 7 + tilt, x + 36, y + 5 + tilt);
    smile(b, x + 24, y + 17, blink);
    return;
  }
  const int bob = (phase / 8) % 2;
  const int cy = y + bob;
  b.ellipse(x + 13, cy + 15, 8, 8);
  b.ellipse(x + 23, cy + 10, 10, 10);
  b.ellipse(x + 33, cy + 15, 9, 8);
  b.rectangle(x + 12, cy + 15, 23, 10);
  smile(b, x + 23, cy + 15, blink);
  if (kind == keyring_core::Icon::Rain) {
    const int fall = (phase / 4) % 3;
    for (int drop = 0; drop < 3; ++drop)
      boldLine(b, x + 13 + drop * 11, y + 27 + fall,
               x + 11 + drop * 11, y + 30 + fall);
  } else if (kind == keyring_core::Icon::Snow) {
    for (int flake = 0; flake < 2; ++flake) {
      const int cx = x + 15 + flake * 17;
      const int fy = y + 29 + (phase / 8) % 2;
      b.line(cx - 3, fy, cx + 3, fy);
      b.line(cx, fy - 3, cx, fy + 3);
      b.pixel(cx - 2, fy - 2); b.pixel(cx + 2, fy + 2);
      b.pixel(cx + 2, fy - 2); b.pixel(cx - 2, fy + 2);
    }
  } else if (kind == keyring_core::Icon::Storm) {
    b.triangle(x + 24, y + 25, x + 18, y + 30, x + 26, y + 30);
    b.triangle(x + 20, y + 29, x + 28, y + 29, x + 21, y + 35);
  } else if (kind == keyring_core::Icon::Fog) {
    boldLine(b, x + 7, y + 29, x + 36, y + 29);
    boldLine(b, x + 13, y + 34, x + 42, y + 34);
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

inline const char* iconLabel(keyring_core::Icon kind) {
  switch (kind) {
    case keyring_core::Icon::Sun: return "맑음";
    case keyring_core::Icon::Cloud: return "흐림";
    case keyring_core::Icon::Rain: return "비";
    case keyring_core::Icon::Snow: return "눈";
    case keyring_core::Icon::Storm: return "번개";
    case keyring_core::Icon::Fog: return "안개";
  }
  return "흐림";
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

inline void renderWeather(FrameBuffer& b, const keyring_core::Weather* weather,
                          keyring_core::WeatherStatus status, uint8_t page,
                          uint8_t phase = 0) {
  using namespace weather_detail;
  b.clear();
  if (!weather) {
    text(b, "날씨 없음", 40, 0);
    icon(b, 39, 14, keyring_core::Icon::Cloud, false, phase);
    text(b, "날씨를 담아 주세요", 16, 51);
    return;
  }
  page %= 5;
  text(b, statusLabel(status), 0, 0);
  char value[24];
  if (page) { text(b, "예보", 78, 0); snprintf(value, sizeof(value), "%u/4", page); text(b, value, 108, 0); }
  else text(b, "날씨", 106, 0);
  const Date received = kstDate(weather->fetchedAt);
  snprintf(value, sizeof(value), "%02u/%02u %02u:%02u", received.month, received.day,
           received.hour, received.minute);
  text(b, "받음", 0, 51); text(b, value, 25, 51);
  if (!page) {
    const keyring_core::Icon kind = keyring_core::weatherIcon(weather->current.code);
    icon(b, 0, 14, kind, false, phase);
    // Rounded tenths avoid libc/JS differences around float conversion.
    const int tenths = static_cast<int>(roundf(weather->current.temperature * 10.0f));
    const unsigned magnitude = static_cast<unsigned>(tenths < 0 ? -tenths : tenths);
    snprintf(value, sizeof(value), "%s%u.%u", tenths < 0 ? "-" : "", magnitude / 10, magnitude % 10);
    const int end = text(b, value, 54, 14, 2);
    text(b, "°", end, 15);
    text(b, iconLabel(kind), 55, 35);
    const Date measured = kstDate(weather->current.time);
    snprintf(value, sizeof(value), "%02u:%02u", measured.hour, measured.minute);
    text(b, value, 87, 36);
    return;
  }
  const size_t start = static_cast<size_t>(page - 1) * 6;
  for (size_t cell = 0; cell < 6; ++cell) {
    const keyring_core::ForecastPoint& point = weather->hourly[start + cell];
    const int x = static_cast<int>(cell % 2) * 64;
    const int y = 14 + static_cast<int>(cell / 2) * 12;
    const Date when = kstDate(point.time);
    snprintf(value, sizeof(value), "%02u", when.hour);
    text(b, value, x, y); text(b, "시", x + 12, y);
    snprintf(value, sizeof(value), "%d", static_cast<int>(roundf(point.temperature)));
    const int end = text(b, value, x + 25, y);
    text(b, "°", end, y);
    icon(b, x + 50, y, keyring_core::weatherIcon(point.code), true, phase);
  }
}

}  // namespace keyring
