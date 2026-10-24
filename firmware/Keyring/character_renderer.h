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

// The carton is the character: only bold, friendly facial features are lit.
// Default proportions follow the approved six-expression OLED design sheet.
inline void thickLine(FrameBuffer& b, int x0, int y0, int x1, int y1,
                      int radius = 2, bool on = true) {
  for (int dy = -radius; dy <= radius; ++dy)
    for (int dx = -radius; dx <= radius; ++dx)
      if (dx * dx + dy * dy <= radius * radius)
        b.line(x0 + dx, y0 + dy, x1 + dx, y1 + dy, on);
}

inline void arc(FrameBuffer& b, int cx, int cy, int halfWidth, int depth,
                int thickness = 5) {
  // Positive depth makes a U; negative depth makes a smiling closed eye.
  for (int x = -halfWidth; x <= halfWidth; ++x) {
    const int dy = depth * (halfWidth * halfWidth - x * x) /
                   (halfWidth * halfWidth);
    for (int row = 0; row < thickness; ++row) b.pixel(cx + x, cy + dy + row);
  }
}

inline void heart(FrameBuffer& b, int cx, int cy, int halfWidth) {
  const int lobe = halfWidth / 2;
  b.ellipse(cx - lobe, cy - 4, lobe + 1, lobe + 1);
  b.ellipse(cx + lobe, cy - 4, lobe + 1, lobe + 1);
  b.triangle(cx - halfWidth - 1, cy - 2,
             cx + halfWidth + 1, cy - 2, cx, cy + halfWidth);
}

inline void sparkle(FrameBuffer& b, int x, int y) {
  b.rectangle(x - 1, y - 5, 3, 11);
  b.rectangle(x - 5, y - 1, 11, 3);
  b.rectangle(x - 2, y - 2, 5, 5);
}

struct FaceStyle {
  int spacing;
  int width;
  int height;
  int smileWidth;
};

inline FaceStyle styleFor(uint8_t style) {
  // Keep the five legacy IDs readable. Their faces share the approved visual
  // language while varying eye proportions, spacing and mouth width.
  static const FaceStyle styles[] = {
      {26, 26, 26, 12}, {25, 24, 28, 11}, {24, 28, 22, 12},
      {23, 22, 22, 10}, {26, 24, 24, 11}};
  return styles[style];
}

inline void openEye(FrameBuffer& b, int x, int y, uint8_t style,
                    const FaceStyle& face) {
  const int rx = face.width / 3;
  const int ry = face.height / 2;
  if (style == 4) {
    // The square-eye option still echoes the user's actual milk-carton photo.
    b.rectangle(x - rx, y - ry + 2, rx * 2 + 1, ry * 2 - 3);
  } else {
    b.ellipse(x, y, rx, ry);
  }
  if (style != 3) b.rectangle(x - rx / 2, y - ry + 6, 5, 5, false);
}

inline void eye(FrameBuffer& b, int x, int y, uint8_t style,
                const FaceStyle& face, uint8_t emotion, uint8_t phase) {
  if (phase == 14) {
    b.rectangle(x - face.width / 2, y + 2, face.width + 1, 4);
    return;
  }
  if (phase == 13 || phase == 15) {
    b.ellipse(x, y + 1, face.width / 2, 4);
    return;
  }
  const int half = face.width / 2;
  if (emotion == 0) {
    if (style == 1 || style == 3 || style == 4) {
      openEye(b, x, y, style, face);
    } else {
      arc(b, x, y + 3, half, -10, 7);
    }
  } else if (emotion == 1) {
    openEye(b, x, y, style, face);
  } else if (emotion == 2) {
    arc(b, x, y, half + 1, 4, 6);
  } else if (emotion == 3) {
    // A single rounded, drooping silhouette; no separate worried eyebrow.
    static const uint8_t edges[][2] = {
        {10,12}, {9,13}, {7,13}, {5,13}, {3,13}, {1,12},
        {0,12}, {0,11}, {0,10}, {1,9}, {3,7}};
    for (int row = 0; row < 11; ++row) {
      const int first = edges[row][0] * face.width / 14 - half;
      const int last = (edges[row][1] + 1) * face.width / 14 - half;
      for (int dx = first; dx < last; ++dx)
        b.rectangle(x + (x < 64 ? dx : -dx), y - 10 + row * 2, 1, 2);
    }
  } else if (emotion == 4) {
    const int direction = x < 64 ? 1 : -1;
    thickLine(b, x - direction * (half - 4), y - 11,
              x + direction * (half - 4), y - 3, 3);
    b.ellipse(x, y + 8, 5, 7);
  } else {
    heart(b, x, y - 1, half - 1);
  }
}

inline void mouth(FrameBuffer& b, int cx, int cy, uint8_t style,
                  const FaceStyle& face, uint8_t emotion, uint8_t phase) {
  if (emotion == 0 || emotion == 5) {
    if (style == 4) {
      b.rectangle(cx - face.smileWidth, cy, 5, 5);
      b.rectangle(cx + face.smileWidth - 4, cy, 5, 5);
      b.rectangle(cx - face.smileWidth + 4, cy + 4,
                  face.smileWidth * 2 - 7, 5);
    } else {
      // A small, plump W smile remains legible without a thin outline.
      const int half = face.smileWidth / 2;
      arc(b, cx - half, cy, half, 4, 5);
      arc(b, cx + half, cy, half, 4, 5);
    }
  } else if (emotion == 1) {
    // Open smiling mouth: thick flat top and a rounded white lower edge.
    b.ellipse(cx, cy + 2, face.smileWidth - 2, 9);
    b.rectangle(cx - face.smileWidth, cy - 8,
                face.smileWidth * 2 + 1, 7, false);
    b.ellipse(cx, cy + 1, face.smileWidth - 6, 5, false);
    b.rectangle(cx - face.smileWidth + 2, cy - 2,
                face.smileWidth * 2 - 3, 4);
  } else if (emotion == 2) {
    const int radius = phase >= 20 && phase < 24 ? 6 : 5;
    b.ellipse(cx, cy + 4, radius, 5);
  } else {
    arc(b, cx, cy + 6, face.smileWidth - 4,
        emotion == 3 ? -5 : -6, 4);
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
  const int cy = 27 + bob;
  eye(b, cx - face.spacing, cy, character, face, emotion, phase);
  eye(b, cx + face.spacing, cy, character, face, emotion, phase);
  mouth(b, cx, 44 + bob, character, face, emotion, phase);

  if (emotion == 0) {
    // Three short cheek strokes are part of the approved happy expression.
    for (int mark = 0; mark < 3; ++mark) {
      b.rectangle(cx - face.spacing - 16 + mark * 5, 44 + bob, 2, 5);
      b.rectangle(cx + face.spacing + 4 + mark * 5, 44 + bob, 2, 5);
    }
  } else if (emotion == 1) {
    sparkle(b, 114, 14 + static_cast<int>(phase / 8 % 2));
  } else if (emotion == 3) {
    const int tearX = cx + face.spacing + 4;
    const int tearY = 45 + static_cast<int>((phase / 4) % 3);
    b.triangle(tearX, tearY - 5, tearX - 3, tearY, tearX + 3, tearY);
    b.ellipse(tearX, tearY + 1, 4, 4);
  }
}

}  // namespace keyring
#endif
