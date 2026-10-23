#pragma once

// Bounded, allocation-free block-program interpreter. No user code is compiled
// or evaluated, and every tick yields after at most kOperationsPerTick steps.
#include "keyring_core.h"
#include <cstddef>
#include <cstdint>
#include <limits>

namespace keyring_program {

static constexpr uint8_t kSchema = 1;
static constexpr uint8_t kMaxNodes = 64;
static constexpr uint8_t kMaxDepth = 4;
static constexpr uint8_t kNone = 255;
static constexpr uint8_t kOperationsPerTick = 16;
static constexpr uint16_t kMinWait = 100;
static constexpr uint16_t kMaxWait = 30000;
static constexpr uint16_t kLoopYieldMs = 100;

enum class Operation : uint8_t { Character, Emotion, Wait, Weather, Repeat, IfWeather };
enum class WeatherKind : uint8_t { Sun, Cloud, Rain, Snow, Unknown };
static const char* const kWeatherKinds[] = {"sun", "cloud", "rain", "snow"};

struct Node {
  Operation operation = Operation::Weather;
  uint8_t value = 0;
  uint16_t milliseconds = 0;
  uint8_t next = kNone;
  uint8_t first = kNone;
  uint8_t alternative = kNone;
};

struct Program {
  bool enabled = true;
  bool loop = true;
  uint8_t count = 0;
  uint8_t root = kNone;
  Node nodes[kMaxNodes];
};

inline bool validateList(const Program& program, uint8_t head, uint8_t depth,
                         uint64_t& visited, uint8_t& seen) {
  if (head != kNone && depth > kMaxDepth) return false;
  for (uint8_t index = head; index != kNone; index = program.nodes[index].next) {
    if (index >= program.count || (visited & (UINT64_C(1) << index))) return false;
    visited |= UINT64_C(1) << index;
    ++seen;
    const Node& node = program.nodes[index];
    switch (node.operation) {
      case Operation::Character:
        if (node.value >= 5 || node.first != kNone || node.alternative != kNone) return false;
        break;
      case Operation::Emotion:
        if (node.value >= 6 || node.first != kNone || node.alternative != kNone) return false;
        break;
      case Operation::Wait:
        if (node.milliseconds < kMinWait || node.milliseconds > kMaxWait || node.first != kNone || node.alternative != kNone) return false;
        break;
      case Operation::Weather:
        if (node.first != kNone || node.alternative != kNone) return false;
        break;
      case Operation::Repeat:
        if (node.value < 1 || node.value > 20 || node.alternative != kNone ||
            !validateList(program, node.first, depth + 1, visited, seen)) return false;
        break;
      case Operation::IfWeather:
        if (node.value >= 4 || !validateList(program, node.first, depth + 1, visited, seen) ||
            !validateList(program, node.alternative, depth + 1, visited, seen)) return false;
        break;
      default: return false;
    }
  }
  return true;
}

inline bool validProgram(const Program& program) {
  if (!program.count || program.count > kMaxNodes || program.root == kNone) return false;
  uint64_t visited = 0;
  uint8_t seen = 0;
  return validateList(program, program.root, 1, visited, seen) && seen == program.count;
}

inline WeatherKind classifyWeather(const keyring_core::Weather* weather) {
  if (!weather || !keyring_core::validWeatherCode(weather->current.code)) return WeatherKind::Unknown;
  switch (keyring_core::weatherIcon(weather->current.code)) {
    case keyring_core::Icon::Sun: return WeatherKind::Sun;
    case keyring_core::Icon::Cloud:
    case keyring_core::Icon::Fog: return WeatherKind::Cloud;
    case keyring_core::Icon::Rain:
    case keyring_core::Icon::Storm: return WeatherKind::Rain;
    case keyring_core::Icon::Snow: return WeatherKind::Snow;
  }
  return WeatherKind::Unknown;
}

class Machine {
 public:
  bool start(const Program& program, const keyring_core::Settings& base, uint64_t nowMs) {
    stop();
    if (!validProgram(program) || !keyring_core::validSettings(base)) return false;
    program_ = &program;
    base_ = base;
    rendered_ = base;
    lastTick_ = nowMs;
    if (!program.enabled) return true;
    running_ = true;
    outputActive_ = true;
    stack_[0] = Frame(program.root, 1);
    depth_ = 1;
    return true;
  }

  void stop() {
    running_ = false;
    outputActive_ = false;
    rendered_ = base_;
    waiting_ = false;
    depth_ = 0;
    lastOperations_ = 0;
  }

  uint8_t tick(uint64_t nowMs, const keyring_core::Weather* weather = nullptr) {
    lastOperations_ = 0;
    if (!running_ || !program_) return 0;
    // esp_timer is monotonic and 64-bit; an accidental rollback must fail safe.
    if (nowMs < lastTick_) { stop(); return 0; }
    lastTick_ = nowMs;
    if (waiting_ && nowMs < resumeAt_) return 0;
    waiting_ = false;
    while (running_ && lastOperations_ < kOperationsPerTick) {
      ++lastOperations_;
      Frame& frame = stack_[depth_ - 1];
      if (frame.pc == kNone) {
        if (frame.remaining > 1) { --frame.remaining; frame.pc = frame.head; continue; }
        --depth_;
        if (depth_) continue;
        if (!program_->loop) { running_ = false; return lastOperations_; }
        stack_[0] = Frame(program_->root, 1);
        depth_ = 1;
        waiting_ = true;
        resumeAt_ = after(nowMs, kLoopYieldMs);
        // Yield at every completed top-level cycle, including programs with waits.
        return lastOperations_;
      }
      if (frame.pc >= program_->count) { stop(); return 0; }
      const Node& node = program_->nodes[frame.pc];
      frame.pc = node.next;
      switch (node.operation) {
        case Operation::Character: rendered_.character = node.value; rendered_.view = 0; break;
        case Operation::Emotion: rendered_.emotion = node.value; rendered_.view = 0; break;
        case Operation::Weather: rendered_.view = 1; break;
        case Operation::Wait:
          waiting_ = true;
          resumeAt_ = after(nowMs, node.milliseconds);
          return lastOperations_;
        case Operation::Repeat:
          if (node.first != kNone && !push(node.first, node.value)) { stop(); return 0; }
          break;
        case Operation::IfWeather: {
          const uint8_t branch = classifyWeather(weather) == static_cast<WeatherKind>(node.value) ? node.first : node.alternative;
          if (branch != kNone && !push(branch, 1)) { stop(); return 0; }
          break;
        }
        default: stop(); return 0;
      }
    }
    return lastOperations_;
  }

  bool running() const { return running_; }
  bool hasOutput() const { return outputActive_; }
  bool waiting() const { return waiting_; }
  uint64_t resumeAt() const { return resumeAt_; }
  uint8_t lastOperations() const { return lastOperations_; }
  const keyring_core::Settings& rendered() const { return rendered_; }

 private:
  struct Frame {
    uint8_t head;
    uint8_t pc;
    uint8_t remaining;
    Frame(uint8_t first = kNone, uint8_t repetitions = 1) : head(first), pc(first), remaining(repetitions) {}
  };
  static uint64_t after(uint64_t now, uint16_t delay) {
    const uint64_t maximum = std::numeric_limits<uint64_t>::max();
    return maximum - now < delay ? maximum : now + delay;
  }
  bool push(uint8_t head, uint8_t count) {
    if (depth_ >= kMaxDepth || head == kNone) return false;
    stack_[depth_++] = Frame(head, count);
    return true;
  }
  const Program* program_ = nullptr;
  keyring_core::Settings base_;
  keyring_core::Settings rendered_;
  Frame stack_[kMaxDepth];
  uint8_t depth_ = 0;
  uint8_t lastOperations_ = 0;
  bool running_ = false;
  bool outputActive_ = false;
  bool waiting_ = false;
  uint64_t resumeAt_ = 0;
  uint64_t lastTick_ = 0;
};

}  // namespace keyring_program
