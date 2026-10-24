#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <set>
#include "../firmware/Keyring/character_renderer.h"

static uint32_t hash(const keyring::FrameBuffer& frame) {
  uint32_t value = 2166136261u;
  for (unsigned i = 0; i < sizeof(frame.data); ++i)
    value = (value ^ frame.data[i]) * 16777619u;
  return value;
}

static int whitePixels(const keyring::FrameBuffer& frame) {
  int count = 0;
  for (int y = 0; y < 64; ++y)
    for (int x = 0; x < 128; ++x) if (frame.get(x, y)) ++count;
  return count;
}

int main() {
  struct Guarded { uint32_t before; keyring::FrameBuffer frame; uint32_t after; };
  Guarded guarded = {0x51f00d51, {}, 0xa17e1234};
  keyring::FrameBuffer& b = guarded.frame;
  b.clear();
  b.pixel(0, 0); b.pixel(127, 63); b.pixel(3, 9);
  assert(b.data[0] == 1);
  assert(b.data[1023] == 128);
  assert(b.data[131] == 2);
  b.pixel(3, 9, false);
  assert(!b.get(3, 9));
  b.pixel(-1, 20); b.pixel(128, 20); b.pixel(20, -1); b.pixel(20, 64);
  assert(!b.get(-1, 0) && !b.get(128, 0) && !b.get(0, 64));
  assert(guarded.before == 0x51f00d51 && guarded.after == 0xa17e1234);

  std::set<uint32_t> identities;
  unsigned checked = 0;
  for (uint8_t character = 0; character < 5; ++character) {
    for (uint8_t emotion = 0; emotion < 6; ++emotion) {
      std::set<uint32_t> animation;
      for (uint8_t phase = 0; phase < 32; ++phase) {
        keyring::renderCharacter(b, character, emotion, phase);
        keyring::FrameBuffer other;
        memset(other.data, 0xff, sizeof(other.data));
        keyring::renderCharacter(other, character, emotion, phase);
        assert(memcmp(b.data, other.data, sizeof(b.data)) == 0);
        const int pixels = whitePixels(b);
        // A milk-carton face is bright features on black, not a filled animal.
        assert(pixels >= 50 && pixels < 1000);
        for (int y = 0; y < 64; ++y)
          for (int x = 0; x < 128; ++x)
            if (x < 8 || x >= 120 || y < 6 || y >= 58)
              assert(!b.get(x, y));
        // The space between the eyes stays black; there is no filled head.
        for (int y = 16; y < 34; ++y)
          for (int x = 56; x < 72; ++x) assert(!b.get(x, y));
        assert(guarded.before == 0x51f00d51 && guarded.after == 0xa17e1234);
        animation.insert(hash(b));
        if (phase == 0) identities.insert(hash(b));
        ++checked;
      }
      assert(animation.size() >= 4);  // Every selection has visible animation.
      keyring::FrameBuffer open, closed;
      keyring::renderCharacter(open, character, emotion, 0);
      keyring::renderCharacter(closed, character, emotion, 14);
      assert(hash(open) != hash(closed));
      // Closed lids remain bright and visible on black. Partial closure on
      // each side of the blink avoids jumping straight from tall eyes to lines.
      const keyring::character_detail::FaceStyle face =
          keyring::character_detail::styleFor(character);
      const int left = 64 - face.spacing;
      const int right = 64 + face.spacing;
      assert(closed.get(left, 28) && closed.get(right, 28));
      assert(!closed.get(left, 22) && !closed.get(right, 22));
      keyring::FrameBuffer half;
      keyring::renderCharacter(half, character, emotion, 13);
      assert(hash(half) != hash(closed));
      assert(half.get(left, 25) && half.get(right, 25));
    }
  }
  assert(identities.size() == 30);  // Eye styles and expressions stay distinct.
  keyring::FrameBuffer fallback, wrapped;
  keyring::renderCharacter(fallback, 255, 255, 0);
  keyring::renderCharacter(wrapped, 4, 0, 32);
  assert(memcmp(fallback.data, wrapped.data, sizeof(fallback.data)) == 0);
  printf("Renderer passed: %u frames, 30 unique face-only selections, bright blink/animation/black margins/bounds.\n", checked);
}
