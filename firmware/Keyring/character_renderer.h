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

// Only facial features are drawn: the real milk-carton shell is the character.
// Keeping the black around the eyes is intentional; do not add a head or body.
inline void boldLine(FrameBuffer& b, int x0, int y0, int x1, int y1,
                     bool on = true) {
  b.line(x0, y0, x1, y1, on);
  b.line(x0, y0 + 1, x1, y1 + 1, on);
}

inline void pill(FrameBuffer& b, int cx, int cy, int width, int height) {
  const int rx = width / 2;
  const int ry = rx < height / 2 ? rx : height / 2;
  if (height <= width) {
    b.ellipse(cx, cy, rx, height / 2);
    return;
  }
  const int y0 = cy - height / 2;
  b.rectangle(cx - rx, y0 + ry, width + 1, height - ry * 2 + 1);
  b.ellipse(cx, y0 + ry, rx, ry);
  b.ellipse(cx, y0 + height - ry, rx, ry);
}

inline void arc(FrameBuffer& b, int cx, int cy, int halfWidth, int depth,
                int thickness = 2) {
  // Positive depth makes a U; negative depth makes a smiling closed eye.
  for (int x = -halfWidth; x <= halfWidth; ++x) {
    const int dy = depth * (halfWidth * halfWidth - x * x) /
                   (halfWidth * halfWidth);
    for (int row = 0; row < thickness; ++row) b.pixel(cx + x, cy + dy + row);
  }
}

inline void heart(FrameBuffer& b, int cx, int cy, int scale = 1) {
  static const uint16_t rows[] = {
      0x0cc, 0x1fe, 0x3ff, 0x3ff, 0x1fe, 0x0fc, 0x078, 0x030};
  const int x0 = cx - 5 * scale;
  const int y0 = cy - 4 * scale;
  for (int y = 0; y < 8; ++y)
    for (int x = 0; x < 10; ++x)
      if (rows[y] & (1u << (9 - x)))
        b.rectangle(x0 + x * scale, y0 + y * scale, scale, scale);
}

inline void sparkle(FrameBuffer& b, int x, int y, int size) {
  b.line(x - size, y, x + size, y);
  b.line(x, y - size, x, y + size);
  b.pixel(x - 1, y - 1); b.pixel(x + 1, y + 1);
}

struct FaceStyle {
  int spacing;
  int width;
  int height;
  int smileWidth;
};

inline FaceStyle styleFor(uint8_t style) {
  // Saved IDs stay compatible with older firmware. Their visible choices are
  // now soft, twinkly, smiling, bean and square eyes, rather than animals.
  static const FaceStyle styles[] = {
      {24, 10, 16, 8}, {25, 12, 18, 9}, {23, 12, 12, 7},
      {21, 8, 12, 6}, {26, 10, 12, 9}};
  return styles[style];
}

inline void openEye(FrameBuffer& b, int x, int y, uint8_t style,
                    const FaceStyle& face) {
  if (style == 2) {
    arc(b, x, y + 3, face.width / 2, -5, 3);
  } else if (style == 4) {
    b.rectangle(x - face.width / 2, y - face.height / 2,
                face.width, face.height);
  } else {
    pill(b, x, y, face.width, face.height);
    if (style == 1) {
      // Two little dark glints give the tall eyes a soft, glassy expression.
      b.rectangle(x - 3, y - 6, 3, 4, false);
      b.pixel(x + 3, y + 4, false);
    } else if (style == 3) {
      b.pixel(x - 3, y - 4, false);
      b.pixel(x + 3, y + 4, false);
    }
  }
}

inline void eye(FrameBuffer& b, int x, int y, uint8_t style,
                const FaceStyle& face, uint8_t emotion, uint8_t phase) {
  if (phase == 14) {
    // The lid is a bright, clearly visible stroke on the black display.
    b.rectangle(x - face.width / 2, y + 2, face.width + 1, 2);
    return;
  }
  if (phase == 13 || phase == 15) {
    b.ellipse(x, y + 1, face.width / 2, 3);
    return;
  }
  if (emotion == 0) {
    openEye(b, x, y, style, face);
  } else if (emotion == 1) {
    arc(b, x, y + 3, face.width / 2 + 1, -6, 3);
  } else if (emotion == 2) {
    arc(b, x, y + 1, face.width / 2 + 1, 3, 2);
    b.pixel(x - face.width / 2 - 1, y + 1);
  } else if (emotion == 3) {
    pill(b, x, y + 1, face.width, face.height - 2);
    b.rectangle(x - 2, y - 3, 2, 3, false);
    const bool left = x < 64;
    boldLine(b, x - 6, y - (left ? 9 : 12),
             x + 6, y - (left ? 12 : 9));
  } else if (emotion == 4) {
    b.ellipse(x, y + 2, face.width / 2, 6);
    const bool left = x < 64;
    // Tiny slanted brows and a pout read as grumpy rather than frightening.
    for (int dx = -face.width / 2 - 1; dx <= face.width / 2 + 1; ++dx) {
      const int cut = left ? dx / 2 : -dx / 2;
      for (int dy = -7; dy <= cut - 1; ++dy) b.pixel(x + dx, y + dy, false);
    }
    boldLine(b, x - 7, y - (left ? 8 : 3),
             x + 7, y - (left ? 3 : 8));
  } else {
    heart(b, x, y, 2);
  }
}

inline void mouth(FrameBuffer& b, int cx, int cy, uint8_t style,
                  const FaceStyle& face, uint8_t emotion, uint8_t phase) {
  if (emotion == 0 || emotion == 5) {
    if (style == 4) {
      // The little stepped smile echoes the photo of the actual milk carton.
      b.rectangle(cx - 10, cy, 4, 3);
      b.rectangle(cx + 6, cy, 4, 3);
      b.rectangle(cx - 7, cy + 3, 14, 3);
    } else if (style == 1) {
      arc(b, cx - 4, cy + 1, 4, 3);
      arc(b, cx + 4, cy + 1, 4, 3);
    } else {
      arc(b, cx, cy, face.smileWidth, 5);
    }
  } else if (emotion == 1) {
    b.ellipse(cx, cy + 2, face.smileWidth - 1, 7);
    b.rectangle(cx - face.smileWidth, cy - 7, face.smileWidth * 2 + 1, 6, false);
    b.rectangle(cx - 2, cy + 4, 5, 2, false);
  } else if (emotion == 2) {
    const int width = phase >= 20 && phase < 24 ? 4 : 3;
    b.outline(cx, cy + 3, width, 3, 1);
  } else if (emotion == 3) {
    arc(b, cx, cy + 5, face.smileWidth - 2, -3);
  } else {
    b.rectangle(cx - face.smileWidth / 2, cy + 2,
                face.smileWidth + 1, 2);
    b.pixel(cx - face.smileWidth / 2, cy + 4);
    b.pixel(cx + face.smileWidth / 2, cy + 4);
  }
}

}  // namespace character_detail

// Stable saved IDs: 0 soft, 1 twinkly, 2 smiling, 3 bean, 4 square eyes.
// 0 happy, 1 excited, 2 sleepy, 3 sad, 4 angry, 5 love.
inline void renderCharacter(FrameBuffer& b, uint8_t character, uint8_t emotion,
                            uint8_t phase) {
  using namespace character_detail;
  b.clear();
  if (character >= kCharacterCount) character = 4;
  if (emotion >= kEmotionCount) emotion = 0;
  phase %= kAnimationFrames;
  const FaceStyle face = styleFor(character);
  const int bob = (phase >= 8 && phase < 12) ||
                  (emotion == 1 && phase >= 24 && phase < 28) ? -1 : 0;
  const int glance = phase >= 20 && phase < 28 ? 1 : 0;
  const int cx = 64 + glance;
  const int cy = 26 + bob;
  eye(b, cx - face.spacing, cy, character, face, emotion, phase);
  eye(b, cx + face.spacing, cy, character, face, emotion, phase);
  mouth(b, cx, 44 + bob, character, face, emotion, phase);

  // Small cheeks and reaction marks never form an enclosing animal silhouette.
  if (emotion == 0 || emotion == 1 || emotion == 5) {
    const int cheekY = 38 + bob;
    b.rectangle(cx - face.spacing - 10, cheekY, 3, 2);
    b.rectangle(cx + face.spacing + 7, cheekY, 3, 2);
  }
  if (emotion == 1) {
    sparkle(b, 14, 17 + static_cast<int>(phase / 8 % 2), 3);
    if (phase / 4 % 2 == 0) sparkle(b, 113, 13, 3);
  } else if (emotion == 2) {
    // A floating sleep bubble replaces the old English Z letters.
    const int lift = static_cast<int>((phase / 8) % 4);
    b.outline(109, 20 - lift * 2, 2 + lift / 2, 2 + lift / 2, 1);
    b.pixel(103, 25 - lift);
    b.pixel(106, 23 - lift);
  } else if (emotion == 3) {
    const int tearY = 37 + static_cast<int>((phase / 4) % 3);
    b.triangle(cx + face.spacing + 10, tearY - 4,
               cx + face.spacing + 7, tearY + 1,
               cx + face.spacing + 13, tearY + 1);
    b.ellipse(cx + face.spacing + 10, tearY + 2, 3, 3);
  } else if (emotion == 4) {
    // Two tiny puffs make the angry face a mild, playful pout.
    const int puff = static_cast<int>(phase / 8 % 2);
    b.outline(15 - puff, 36, 3, 2, 1);
    b.outline(113 + puff, 36, 3, 2, 1);
  } else if (emotion == 5) {
    const int lift = static_cast<int>((phase / 4) % 4);
    heart(b, 13, 17 - lift * 2, 1);
    if (phase / 8 % 2 == 0) heart(b, 113, 46 - lift, 1);
  }
}

}  // namespace keyring
#endif
