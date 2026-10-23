#ifndef KEYRING_CHARACTER_RENDERER_H
#define KEYRING_CHARACTER_RENDERER_H

// The browser atlas is generated from this exact renderer. Pixel storage is the
// SSD1306/Adafruit page format: x + (y / 8) * 128, least significant bit first.
#include <stdint.h>
#include <string.h>

namespace keyring {

static const uint8_t kCharacterCount = 5;
static const uint8_t kEmotionCount = 6;
static const uint8_t kAnimationFrames = 32;
static const uint16_t kFrameMilliseconds = 160;

struct FrameBuffer {
  uint8_t data[1024];

  void clear() { memset(data, 0, sizeof(data)); }

  void pixel(int x, int y, bool on = true) {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    const int index = x + (y / 8) * 128;
    const uint8_t mask = static_cast<uint8_t>(1u << (y & 7));
    if (on) data[index] |= mask;
    else data[index] &= static_cast<uint8_t>(~mask);
  }

  bool get(int x, int y) const {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return false;
    return (data[x + (y / 8) * 128] & (1u << (y & 7))) != 0;
  }

  void line(int x0, int y0, int x1, int y1, bool on = true) {
    int dx = x1 > x0 ? x1 - x0 : x0 - x1;
    const int sx = x0 < x1 ? 1 : -1;
    int dy = y1 > y0 ? y0 - y1 : y1 - y0;
    const int sy = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    for (;;) {
      pixel(x0, y0, on);
      if (x0 == x1 && y0 == y1) break;
      const int twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
  }

  void rectangle(int x, int y, int width, int height, bool on = true) {
    for (int j = 0; j < height; ++j)
      for (int i = 0; i < width; ++i) pixel(x + i, y + j, on);
  }

  void ellipse(int cx, int cy, int rx, int ry, bool on = true) {
    if (rx < 1 || ry < 1) { pixel(cx, cy, on); return; }
    const int32_t rr = static_cast<int32_t>(rx) * rx * ry * ry;
    for (int y = -ry; y <= ry; ++y)
      for (int x = -rx; x <= rx; ++x)
        if (static_cast<int32_t>(x) * x * ry * ry +
                static_cast<int32_t>(y) * y * rx * rx <= rr)
          pixel(cx + x, cy + y, on);
  }

  void outline(int cx, int cy, int rx, int ry, int thickness = 2) {
    ellipse(cx, cy, rx, ry);
    if (rx > thickness && ry > thickness)
      ellipse(cx, cy, rx - thickness, ry - thickness, false);
  }

  void triangle(int ax, int ay, int bx, int by, int cx, int cy,
                bool on = true) {
    int minX = ax < bx ? ax : bx;
    if (cx < minX) minX = cx;
    int maxX = ax > bx ? ax : bx;
    if (cx > maxX) maxX = cx;
    int minY = ay < by ? ay : by;
    if (cy < minY) minY = cy;
    int maxY = ay > by ? ay : by;
    if (cy > maxY) maxY = cy;
    // All callers use small on-screen shapes, but clamp the raster loop too.
    if (minX < 0) minX = 0;
    if (maxX > 127) maxX = 127;
    if (minY < 0) minY = 0;
    if (maxY > 63) maxY = 63;
    for (int y = minY; y <= maxY; ++y) {
      for (int x = minX; x <= maxX; ++x) {
        const int e0 = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
        const int e1 = (x - bx) * (cy - by) - (y - by) * (cx - bx);
        const int e2 = (x - cx) * (ay - cy) - (y - cy) * (ax - cx);
        if ((e0 >= 0 && e1 >= 0 && e2 >= 0) ||
            (e0 <= 0 && e1 <= 0 && e2 <= 0)) pixel(x, y, on);
      }
    }
  }
};

namespace character_detail {

inline void boldLine(FrameBuffer& b, int x0, int y0, int x1, int y1) {
  b.line(x0, y0, x1, y1);
  b.line(x0, y0 + 1, x1, y1 + 1);
}

inline void heart(FrameBuffer& b, int x, int y, int scale) {
  b.ellipse(x - 2 * scale, y, 2 * scale, 2 * scale);
  b.ellipse(x + 2 * scale, y, 2 * scale, 2 * scale);
  b.triangle(x - 4 * scale, y, x + 4 * scale, y,
             x, y + 5 * scale);
}

inline void sparkle(FrameBuffer& b, int x, int y, int size) {
  b.line(x - size, y, x + size, y);
  b.line(x, y - size, x, y + size);
  b.pixel(x - 1, y - 1);
  b.pixel(x + 1, y + 1);
}

inline void smile(FrameBuffer& b, int x, int y, int size) {
  // A thick U; the open upper half keeps the mouth legible on real OLEDs.
  for (int i = -size; i <= size; ++i) {
    const int dy = size > 0 ? (size * size - i * i) / (size + 1) : 0;
    b.pixel(x + i, y + dy);
    b.pixel(x + i, y + dy + 1);
  }
}

inline void sleepyZ(FrameBuffer& b, int x, int y, int size) {
  boldLine(b, x, y, x + size, y);
  boldLine(b, x + size, y, x, y + size);
  boldLine(b, x, y + size, x + size, y + size);
}

inline void eyes(FrameBuffer& b, int cx, int cy, uint8_t emotion,
                 bool blinking) {
  const int left = cx - 11;
  const int right = cx + 11;
  if (blinking) {
    boldLine(b, left - 4, cy + 1, left + 4, cy + 1);
    boldLine(b, right - 4, cy + 1, right + 4, cy + 1);
    return;
  }
  if (emotion == 0) {
    for (int x = left; x <= right; x += 22) {
      boldLine(b, x - 4, cy + 1, x, cy - 3);
      boldLine(b, x, cy - 3, x + 4, cy + 1);
    }
  } else if (emotion == 1) {
    b.ellipse(left, cy, 3, 6);
    b.ellipse(right, cy, 3, 6);
    b.pixel(left - 1, cy - 3, false);
    b.pixel(right - 1, cy - 3, false);
  } else if (emotion == 2) {
    boldLine(b, left - 4, cy, left + 4, cy + 1);
    boldLine(b, right - 4, cy + 1, right + 4, cy);
    b.pixel(left - 4, cy + 2);
    b.pixel(right + 4, cy + 2);
  } else if (emotion == 3) {
    b.ellipse(left, cy + 1, 2, 4);
    b.ellipse(right, cy + 1, 2, 4);
    boldLine(b, left - 4, cy - 6, left + 3, cy - 9);
    boldLine(b, right - 3, cy - 9, right + 4, cy - 6);
  } else if (emotion == 4) {
    b.ellipse(left, cy + 1, 2, 3);
    b.ellipse(right, cy + 1, 2, 3);
    boldLine(b, left - 5, cy - 7, left + 4, cy - 3);
    boldLine(b, right - 4, cy - 3, right + 5, cy - 7);
  } else {
    heart(b, left, cy - 2, 1);
    heart(b, right, cy - 2, 1);
  }
}

inline void face(FrameBuffer& b, int cx, int cy, uint8_t emotion,
                 uint8_t phase, uint8_t character) {
  eyes(b, cx, cy - 2, emotion, phase == 14 || phase == 15);
  if (emotion == 0 || emotion == 5) smile(b, cx, cy + 8, 6);
  else if (emotion == 1) {
    b.outline(cx, cy + 11, 5, 5, 2);
    b.rectangle(cx - 2, cy + 13, 5, 1);
  } else if (emotion == 2) b.outline(cx, cy + 10, 3, 2, 1);
  else if (emotion == 3) {
    boldLine(b, cx - 5, cy + 12, cx, cy + 9);
    boldLine(b, cx, cy + 9, cx + 5, cy + 12);
    const int tearY = cy + 7 + static_cast<int>((phase / 4) % 3);
    b.ellipse(cx + 16, tearY, 1, 2);
  } else {
    boldLine(b, cx - 5, cy + 12, cx, cy + 10);
    boldLine(b, cx, cy + 10, cx + 5, cy + 12);
  }
  if (emotion == 0 || emotion == 1 || emotion == 5) {
    b.line(cx - 19, cy + 5, cx - 16, cy + 6);
    b.line(cx + 16, cy + 6, cx + 19, cy + 5);
  }
  if (character == 1) {
    // Cat nose and short whiskers, outside the expression's mouth.
    b.triangle(cx - 2, cy + 4, cx + 2, cy + 4, cx, cy + 6);
    b.line(cx - 25, cy + 3, cx - 18, cy + 4);
    b.line(cx - 26, cy + 8, cx - 19, cy + 7);
    b.line(cx + 18, cy + 4, cx + 25, cy + 3);
    b.line(cx + 19, cy + 7, cx + 26, cy + 8);
  } else if (character == 2) {
    b.ellipse(cx, cy + 4, 3, 2);
  }
}

}  // namespace character_detail

// 0 rabbit, 1 cat, 2 bear, 3 turtle, 4 monster.
// 0 happy, 1 excited, 2 sleepy, 3 sad, 4 angry, 5 love.
inline void renderCharacter(FrameBuffer& b, uint8_t character, uint8_t emotion,
                            uint8_t phase) {
  using namespace character_detail;
  b.clear();
  if (character >= kCharacterCount) character = 4;
  if (emotion >= kEmotionCount) emotion = 0;
  phase %= kAnimationFrames;
  const int bob = (phase >= 8 && phase < 12) ||
                  (emotion == 1 && phase >= 24 && phase < 28) ? -1 : 0;
  const int sway = phase >= 20 && phase < 28 ? 1 : 0;
  const int cx = 64 + sway;
  int cy = 35 + bob;

  if (character == 0) {
    const int twitch = phase >= 24 && phase < 27 ? 2 : 0;
    b.outline(cx - 15 - twitch, 15 + bob, 8, 14, 2);
    b.outline(cx + 15 + twitch, 15 + bob, 8, 14, 2);
    b.rectangle(cx - 17 - twitch, 9 + bob, 4, 12);
    b.rectangle(cx + 13 + twitch, 9 + bob, 4, 12);
    b.outline(cx, 38 + bob, 29, 23, 2);
    b.ellipse(cx - 15, 59 + bob, 7, 3);
    b.ellipse(cx + 15, 59 + bob, 7, 3);
  } else if (character == 1) {
    b.triangle(cx - 28, 31 + bob, cx - 25, 6 + bob,
               cx - 7, 23 + bob);
    b.triangle(cx + 7, 23 + bob, cx + 25, 6 + bob,
               cx + 28, 31 + bob);
    b.triangle(cx - 24, 24 + bob, cx - 23, 12 + bob,
               cx - 13, 23 + bob, false);
    b.triangle(cx + 13, 23 + bob, cx + 23, 12 + bob,
               cx + 24, 24 + bob, false);
    b.outline(cx, 37 + bob, 29, 23, 2);
    // The tail flicks to the right of the head, never behind the face.
    b.outline(cx + 37, 49 + bob - static_cast<int>(phase / 8 % 2), 6, 8, 2);
    b.rectangle(cx + 30, 45 + bob, 5, 12, false);
    b.line(cx + 29, 56 + bob, cx + 37, 56 + bob);
  } else if (character == 2) {
    b.outline(cx - 23, 16 + bob, 11, 11, 2);
    b.outline(cx + 23, 16 + bob, 11, 11, 2);
    b.ellipse(cx - 23, 16 + bob, 4, 4);
    b.ellipse(cx + 23, 16 + bob, 4, 4);
    b.outline(cx, 36 + bob, 31, 25, 2);
    b.ellipse(cx - 21, 58 + bob, 7, 4);
    b.ellipse(cx + 21, 58 + bob, 7, 4);
    if (phase >= 24 && phase < 28) {
      b.outline(cx - 37, 39 + bob, 5, 8, 2);
      b.line(cx - 35, 46 + bob, cx - 29, 49 + bob);
    }
  } else if (character == 3) {
    b.outline(cx, 45 + bob, 38, 17, 2);
    b.line(cx - 25, 48 + bob, cx - 16, 59 + bob);
    b.line(cx + 25, 48 + bob, cx + 16, 59 + bob);
    b.line(cx - 16, 59 + bob, cx + 16, 59 + bob);
    const int step = phase >= 16 && phase < 24 ? 1 : 0;
    b.ellipse(cx - 29, 58 + bob - step, 8, 4);
    b.ellipse(cx + 29, 58 + bob + step, 8, 4);
    b.ellipse(cx - 31, 35 + bob, 9, 4);
    b.ellipse(cx + 31, 35 + bob, 9, 4);
    b.ellipse(cx, 29 + bob, 27, 24, false);
    b.outline(cx, 29 + bob, 27, 24, 2);
    cy = 27 + bob;
  } else {
    const int twitch = phase >= 24 && phase < 28 ? 2 : 0;
    b.triangle(cx - 25, 25 + bob, cx - 28 - twitch, 5 + bob,
               cx - 9, 16 + bob);
    b.triangle(cx + 9, 16 + bob, cx + 28 + twitch, 5 + bob,
               cx + 25, 25 + bob);
    b.outline(cx, 36 + bob, 31, 25, 2);
    b.outline(cx - 36, 41 + bob, 5, 9, 2);
    b.outline(cx + 36, 41 + bob, 5, 9, 2);
    b.ellipse(cx - 15, 60 + bob, 8, 3);
    b.ellipse(cx + 15, 60 + bob, 8, 3);
    b.rectangle(cx - 1, 12 + bob, 3, 5);
  }

  face(b, cx, cy, emotion, phase, character);
  // Peripheral expression animations leave the face large and unobstructed.
  if (emotion == 1) {
    sparkle(b, 15, 22 + static_cast<int>(phase / 8 % 2), 3);
    if (phase / 4 % 2 == 0) sparkle(b, 111, 11, 4);
  } else if (emotion == 2) {
    sleepyZ(b, 99, 22 - static_cast<int>(phase / 8), 5);
    if (phase >= 16) sleepyZ(b, 109, 10 - static_cast<int>(phase / 16), 7);
  } else if (emotion == 4) {
    boldLine(b, 105, 22, 109, 26);
    boldLine(b, 109, 22, 105, 26);
    if (phase / 4 % 2 == 0) {
      b.line(101, 22, 103, 24);
      b.line(111, 26, 113, 28);
    }
  } else if (emotion == 5) {
    const int lift = static_cast<int>((phase / 4) % 4);
    heart(b, 16, 26 - lift * 2, phase / 8 % 2 == 0 ? 1 : 2);
    heart(b, 111, 18 - lift, 1);
  }
}

}  // namespace keyring
#endif
