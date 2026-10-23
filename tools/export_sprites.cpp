#include <iostream>
#include "../firmware/Keyring/character_renderer.h"

namespace {
void base64(const uint8_t* bytes, size_t length) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (size_t i = 0; i < length; i += 3) {
    const uint32_t word = (static_cast<uint32_t>(bytes[i]) << 16) |
        (i + 1 < length ? static_cast<uint32_t>(bytes[i + 1]) << 8 : 0) |
        (i + 2 < length ? bytes[i + 2] : 0);
    std::cout << alphabet[(word >> 18) & 63] << alphabet[(word >> 12) & 63]
              << (i + 1 < length ? alphabet[(word >> 6) & 63] : '=')
              << (i + 2 < length ? alphabet[word & 63] : '=');
  }
}
}

int main() {
  const char* characters[] = {"rabbit", "cat", "bear", "turtle", "monster"};
  const char* emotions[] = {"happy", "excited", "sleepy", "sad", "angry", "love"};
  std::cout << "{\"width\":128,\"height\":64,\"frameMs\":160,\"frames\":32,"
               "\"characters\":[\"rabbit\",\"cat\",\"bear\",\"turtle\",\"monster\"],"
               "\"emotions\":[\"happy\",\"excited\",\"sleepy\",\"sad\",\"angry\",\"love\"],\"data\":{";
  bool first = true;
  keyring::FrameBuffer frame;
  for (uint8_t character = 0; character < keyring::kCharacterCount; ++character) {
    for (uint8_t emotion = 0; emotion < keyring::kEmotionCount; ++emotion) {
      if (!first) std::cout << ',';
      first = false;
      std::cout << '"' << characters[character] << ':' << emotions[emotion] << "\":[";
      for (uint8_t phase = 0; phase < keyring::kAnimationFrames; ++phase) {
        if (phase) std::cout << ',';
        keyring::renderCharacter(frame, character, emotion, phase);
        std::cout << '"';
        base64(frame.data, sizeof(frame.data));
        std::cout << '"';
      }
      std::cout << ']';
    }
  }
  std::cout << "}}\n";
}
