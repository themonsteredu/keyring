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

inline void boldLine(FrameBuffer& b, int x0, int y0, int x1, int y1,
                     bool on = true) {
  b.line(x0, y0, x1, y1, on);
  b.line(x0, y0 + 1, x1, y1 + 1, on);
}

inline void heart(FrameBuffer& b, int x, int y, int scale, bool on = true) {
  b.ellipse(x - 2 * scale, y, 2 * scale, 2 * scale, on);
  b.ellipse(x + 2 * scale, y, 2 * scale, 2 * scale, on);
  b.triangle(x - 4 * scale, y, x + 4 * scale, y,
             x, y + 5 * scale, on);
}

inline void sparkle(FrameBuffer& b, int x, int y, int size) {
  b.line(x - size, y, x + size, y);
  b.line(x, y - size, x, y + size);
  b.pixel(x - 1, y - 1);
  b.pixel(x + 1, y + 1);
}

inline void smile(FrameBuffer& b, int x, int y, int size, bool on = true) {
  // Rounded, two-pixel smile; the top stays open even on the physical OLED.
  for (int i = -size; i <= size; ++i) {
    const int dy = size > 0 ? (size * size - i * i) / (size + 1) : 0;
    b.pixel(x + i, y + dy, on);
    b.pixel(x + i, y + dy + 1, on);
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
  // White plush silhouettes carry dark eyes. Never paint a separate blank
  // display frame: these cuts are made only in the completed RAM framebuffer.
  if (blinking) {
    boldLine(b, left - 4, cy + 1, left + 4, cy + 1, false);
    boldLine(b, right - 4, cy + 1, right + 4, cy + 1, false);
    return;
  }
  if (emotion == 0) {
    for (int x = left; x <= right; x += 22) {
      b.ellipse(x, cy, 3, 5, false);
      b.rectangle(x - 1, cy - 3, 2, 2);
    }
  } else if (emotion == 1) {
    for (int x = left; x <= right; x += 22) {
      b.ellipse(x, cy - 1, 4, 7, false);
      b.rectangle(x - 1, cy - 5, 2, 3);
      b.pixel(x + 2, cy + 2);
    }
  } else if (emotion == 2) {
    boldLine(b, left - 5, cy, left + 4, cy + 1, false);
    boldLine(b, right - 4, cy + 1, right + 5, cy, false);
    b.pixel(left - 5, cy + 2, false);
    b.pixel(right + 5, cy + 2, false);
  } else if (emotion == 3) {
    for (int x = left; x <= right; x += 22) {
      b.ellipse(x, cy + 1, 3, 5, false);
      b.rectangle(x - 1, cy - 1, 2, 2);
    }
    boldLine(b, left - 5, cy - 7, left + 3, cy - 10, false);
    boldLine(b, right - 3, cy - 10, right + 5, cy - 7, false);
  } else if (emotion == 4) {
    b.triangle(left - 5, cy - 2, left + 4, cy + 1,
               left - 3, cy + 5, false);
    b.triangle(right - 4, cy + 1, right + 5, cy - 2,
               right + 3, cy + 5, false);
    boldLine(b, left - 6, cy - 7, left + 4, cy - 3, false);
    boldLine(b, right - 4, cy - 3, right + 6, cy - 7, false);
  } else {
    heart(b, left, cy - 2, 1, false);
    heart(b, right, cy - 2, 1, false);
  }
}

inline void face(FrameBuffer& b, int cx, int cy, uint8_t emotion,
                 uint8_t phase, uint8_t character) {
  eyes(b, cx, cy - 2, emotion, phase == 14 || phase == 15);
  if (emotion == 0 || emotion == 5) smile(b, cx, cy + 8, 7, false);
  else if (emotion == 1) {
    b.ellipse(cx, cy + 11, 6, 6, false);
    b.rectangle(cx - 2, cy + 14, 5, 2);
  } else if (emotion == 2) {
    b.ellipse(cx, cy + 10, 3, 2, false);
    if (phase / 8 % 2) b.pixel(cx, cy + 13, false);
  }
  else if (emotion == 3) {
    boldLine(b, cx - 5, cy + 12, cx, cy + 9, false);
    boldLine(b, cx, cy + 9, cx + 5, cy + 12, false);
    const int tearY = cy + 5 + static_cast<int>((phase / 4) % 3);
    b.triangle(cx + 16, tearY - 3, cx + 14, tearY + 1,
               cx + 18, tearY + 1, false);
    b.ellipse(cx + 16, tearY + 2, 2, 2, false);
    b.pixel(cx + 16, tearY + 2);
  } else {
    boldLine(b, cx - 5, cy + 12, cx, cy + 10, false);
    boldLine(b, cx, cy + 10, cx + 5, cy + 12, false);
  }
  if (emotion == 0 || emotion == 1 || emotion == 5) {
    b.line(cx - 20, cy + 5, cx - 18, cy + 7, false);
    b.line(cx - 17, cy + 5, cx - 15, cy + 7, false);
    b.line(cx + 15, cy + 7, cx + 17, cy + 5, false);
    b.line(cx + 18, cy + 7, cx + 20, cy + 5, false);
  }
  if (character == 1) {
    b.triangle(cx - 2, cy + 3, cx + 2, cy + 3, cx, cy + 5, false);
    // Dark inner whiskers continue as bright tips outside the white face.
    b.line(cx - 26, cy + 3, cx - 19, cy + 4, false);
    b.line(cx - 26, cy + 8, cx - 20, cy + 7, false);
    b.line(cx + 19, cy + 4, cx + 26, cy + 3, false);
    b.line(cx + 20, cy + 7, cx + 26, cy + 8, false);
    boldLine(b, cx - 34, cy + 1, cx - 29, cy + 2);
    boldLine(b, cx + 29, cy + 2, cx + 34, cy + 1);
    b.line(cx - 34, cy + 8, cx - 29, cy + 7);
    b.line(cx + 29, cy + 7, cx + 34, cy + 8);
  } else if (character == 2) {
    b.ellipse(cx, cy + 3, 4, 2, false);
    b.pixel(cx - 1, cy + 2);
  } else if (character == 3) {
    b.pixel(cx - 3, cy + 4, false);
    b.pixel(cx + 3, cy + 4, false);
  } else if (character == 0) {
    b.triangle(cx - 2, cy + 3, cx + 2, cy + 3, cx, cy + 5, false);
  } else if (character == 4 && emotion == 1) {
    // Two tiny friendly teeth make the monster's open smile its own.
    b.triangle(cx - 4, cy + 7, cx - 1, cy + 7, cx - 3, cy + 10);
    b.triangle(cx + 1, cy + 7, cx + 4, cy + 7, cx + 3, cy + 10);
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
    b.ellipse(cx - 14 - twitch, 14 + bob, 7, 13);
    b.ellipse(cx + 14 + twitch, 14 + bob, 7, 13);
    b.ellipse(cx - 14 - twitch, 13 + bob, 3, 8, false);
    b.ellipse(cx + 14 + twitch, 13 + bob, 3, 8, false);
    b.ellipse(cx - 14, 59 + bob, 7, 3);
    b.ellipse(cx + 14, 59 + bob, 7, 3);
    b.ellipse(cx, 39 + bob, 28, 21);
    // Small front paws give the bunny a plush shape instead of a floating head.
    b.line(cx - 17, 54 + bob, cx - 14, 56 + bob, false);
    b.line(cx + 14, 56 + bob, cx + 17, 54 + bob, false);
  } else if (character == 1) {
    const int flick = static_cast<int>(phase / 8 % 2);
    boldLine(b, cx + 25, 56 + bob, cx + 37, 56 + bob);
    boldLine(b, cx + 37, 56 + bob, cx + 43, 50 + bob);
    boldLine(b, cx + 43, 50 + bob, cx + 43, 40 + bob - flick);
    boldLine(b, cx + 43, 40 + bob - flick, cx + 39, 36 + bob - flick);
    boldLine(b, cx + 39, 36 + bob - flick, cx + 35, 38 + bob - flick);
    b.triangle(cx - 28, 31 + bob, cx - 24, 5 + bob, cx - 7, 24 + bob);
    b.triangle(cx + 7, 24 + bob, cx + 24, 5 + bob, cx + 28, 31 + bob);
    b.triangle(cx - 24, 24 + bob, cx - 22, 12 + bob, cx - 13, 24 + bob, false);
    b.triangle(cx + 13, 24 + bob, cx + 22, 12 + bob, cx + 24, 24 + bob, false);
    b.ellipse(cx - 15, 59 + bob, 7, 3);
    b.ellipse(cx + 15, 59 + bob, 7, 3);
    b.ellipse(cx, 39 + bob, 29, 21);
    b.line(cx - 17, 55 + bob, cx - 15, 57 + bob, false);
    b.line(cx + 15, 57 + bob, cx + 17, 55 + bob, false);
  } else if (character == 2) {
    b.ellipse(cx - 22, 15 + bob, 9, 9);
    b.ellipse(cx + 22, 15 + bob, 9, 9);
    b.ellipse(cx - 22, 15 + bob, 4, 4, false);
    b.ellipse(cx + 22, 15 + bob, 4, 4, false);
    b.ellipse(cx - 18, 59 + bob, 7, 3);
    b.ellipse(cx + 18, 59 + bob, 7, 3);
    if (phase >= 24 && phase < 28) {
      b.ellipse(cx - 34, 35 + bob, 5, 7);
      b.line(cx - 34, 32 + bob, cx - 34, 35 + bob, false);
    }
    b.ellipse(cx, 38 + bob, 28, 21);
    b.line(cx - 21, 54 + bob, cx - 18, 57 + bob, false);
    b.line(cx + 18, 57 + bob, cx + 21, 54 + bob, false);
  } else if (character == 3) {
    b.outline(cx, 48 + bob, 37, 14, 2);
    b.line(cx - 17, 50 + bob, cx - 28, 56 + bob);
    b.line(cx + 17, 50 + bob, cx + 28, 56 + bob);
    b.line(cx - 11, 53 + bob, cx + 11, 53 + bob);
    b.line(cx - 11, 53 + bob, cx - 16, 58 + bob);
    b.line(cx + 11, 53 + bob, cx + 16, 58 + bob);
    b.line(cx - 16, 58 + bob, cx - 11, 61 + bob);
    b.line(cx + 16, 58 + bob, cx + 11, 61 + bob);
    const int step = phase >= 16 && phase < 24 ? 1 : 0;
    b.ellipse(cx - 28, 58 + bob - step, 7, 4);
    b.ellipse(cx + 28, 58 + bob + step, 7, 4);
    b.ellipse(cx - 30, 35 + bob, 8, 4);
    b.ellipse(cx + 30, 35 + bob, 8, 4);
    b.ellipse(cx, 30 + bob, 27, 23, false);
    b.ellipse(cx, 30 + bob, 25, 21);
    cy = 27 + bob;
  } else {
    const int twitch = phase >= 24 && phase < 28 ? 2 : 0;
    b.triangle(cx - 24, 26 + bob, cx - 23 - twitch, 5 + bob, cx - 8, 18 + bob);
    b.triangle(cx + 8, 18 + bob, cx + 23 + twitch, 5 + bob, cx + 24, 26 + bob);
    b.line(cx - 24 - twitch, 11 + bob, cx - 17, 12 + bob, false);
    b.line(cx + 17, 12 + bob, cx + 24 + twitch, 11 + bob, false);
    const int wave = phase >= 24 && phase < 28 ? -5 : 0;
    b.ellipse(cx - 32, 42 + bob + wave, 4, 7);
    b.ellipse(cx + 32, 42 + bob, 4, 7);
    b.ellipse(cx - 15, 59 + bob, 7, 3);
    b.ellipse(cx + 15, 59 + bob, 7, 3);
    b.ellipse(cx, 38 + bob, 28, 21);
    b.triangle(cx - 3, 20 + bob, cx + 3, 20 + bob, cx, 24 + bob, false);
    b.line(cx - 33, 40 + bob + wave, cx - 31, 42 + bob + wave, false);
    b.line(cx + 31, 42 + bob, cx + 33, 40 + bob, false);
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
    const int pulse = phase / 4 % 2;
    boldLine(b, 104 - pulse, 18, 104 - pulse, 21);
    boldLine(b, 101 - pulse, 21, 104 - pulse, 21);
    boldLine(b, 110 + pulse, 18, 110 + pulse, 21);
    boldLine(b, 110 + pulse, 21, 113 + pulse, 21);
    boldLine(b, 104 - pulse, 26, 104 - pulse, 29);
    boldLine(b, 101 - pulse, 26, 104 - pulse, 26);
    boldLine(b, 110 + pulse, 26, 113 + pulse, 26);
    boldLine(b, 110 + pulse, 26, 110 + pulse, 29);
  } else if (emotion == 5) {
    const int lift = static_cast<int>((phase / 4) % 4);
    heart(b, 16, 26 - lift * 2, phase / 8 % 2 == 0 ? 1 : 2);
    heart(b, 111, 18 - lift, 1);
  }
}

}  // namespace keyring
#endif
