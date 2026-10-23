#pragma once

// One strict codec is used both on ESP32 and in native round-trip tests.
#include <ArduinoJson.h>
#include <cstring>
#include "program_core.h"

namespace keyring_program {

inline bool plainString(JsonVariantConst input) {
  return input.is<const char*>() && input.as<JsonString>().size() == std::strlen(input.as<const char*>());
}

template <size_t N>
inline bool exactKeys(JsonObjectConst object, const char* const (&keys)[N]) {
  if (object.size() != N) return false;
  for (JsonPairConst pair : object) {
    if (pair.key().size() != std::strlen(pair.key().c_str())) return false;
    bool known = false;
    for (size_t i = 0; i < N; ++i) if (std::strcmp(pair.key().c_str(), keys[i]) == 0) { known = true; break; }
    if (!known) return false;
  }
  return true;
}

inline bool decodeList(JsonArrayConst input, Program& program, uint8_t depth,
                       uint8_t& head, const char*& error) {
  head = kNone;
  if (input.size() && depth > kMaxDepth) { error = "program_depth_limit"; return false; }
  uint8_t previous = kNone;
  for (JsonVariantConst entry : input) {
    if (program.count >= kMaxNodes) { error = "program_nodes_limit"; return false; }
    if (!entry.is<JsonObjectConst>() || !plainString(entry["type"])) { error = "invalid_block"; return false; }
    const JsonObjectConst object = entry.as<JsonObjectConst>();
    const uint8_t index = program.count++;
    Node& node = program.nodes[index];
    if (previous == kNone) head = index;
    else program.nodes[previous].next = index;
    previous = index;
    const char* type = object["type"].as<const char*>();
    static const char* const valueKeys[] = {"type", "value"};
    static const char* const waitKeys[] = {"type", "ms"};
    static const char* const weatherKeys[] = {"type"};
    static const char* const repeatKeys[] = {"type", "count", "blocks"};
    static const char* const ifKeys[] = {"type", "kind", "then", "else"};
    if (std::strcmp(type, "character") == 0 || std::strcmp(type, "emotion") == 0) {
      if (!exactKeys(object, valueKeys) || !plainString(object["value"])) { error = "invalid_block"; return false; }
      const bool character = std::strcmp(type, "character") == 0;
      const int value = character ? keyring_core::findName(object["value"].as<const char*>(), keyring_core::kCharacters)
                                  : keyring_core::findName(object["value"].as<const char*>(), keyring_core::kEmotions);
      if (value < 0) { error = "invalid_block_value"; return false; }
      node.operation = character ? Operation::Character : Operation::Emotion;
      node.value = static_cast<uint8_t>(value);
    } else if (std::strcmp(type, "wait") == 0) {
      if (!exactKeys(object, waitKeys) || !object["ms"].is<uint32_t>()) { error = "invalid_wait"; return false; }
      const uint32_t milliseconds = object["ms"].as<uint32_t>();
      if (milliseconds < kMinWait || milliseconds > kMaxWait) { error = "invalid_wait"; return false; }
      node.operation = Operation::Wait;
      node.milliseconds = static_cast<uint16_t>(milliseconds);
    } else if (std::strcmp(type, "weather") == 0) {
      if (!exactKeys(object, weatherKeys)) { error = "invalid_block"; return false; }
      node.operation = Operation::Weather;
    } else if (std::strcmp(type, "repeat") == 0) {
      if (!exactKeys(object, repeatKeys) || !object["count"].is<int>() || !object["blocks"].is<JsonArrayConst>()) { error = "invalid_repeat"; return false; }
      const int count = object["count"].as<int>();
      if (count < 1 || count > 20) { error = "invalid_repeat"; return false; }
      node.operation = Operation::Repeat;
      node.value = static_cast<uint8_t>(count);
      if (!decodeList(object["blocks"].as<JsonArrayConst>(), program, depth + 1, node.first, error)) return false;
    } else if (std::strcmp(type, "ifWeather") == 0) {
      if (!exactKeys(object, ifKeys) || !plainString(object["kind"]) ||
          !object["then"].is<JsonArrayConst>() || !object["else"].is<JsonArrayConst>()) { error = "invalid_condition"; return false; }
      const int kind = keyring_core::findName(object["kind"].as<const char*>(), kWeatherKinds);
      if (kind < 0) { error = "invalid_condition"; return false; }
      node.operation = Operation::IfWeather;
      node.value = static_cast<uint8_t>(kind);
      if (!decodeList(object["then"].as<JsonArrayConst>(), program, depth + 1, node.first, error) ||
          !decodeList(object["else"].as<JsonArrayConst>(), program, depth + 1, node.alternative, error)) return false;
    } else { error = "unknown_block_type"; return false; }
  }
  return true;
}

inline bool decodeProgram(JsonVariantConst input, Program& output, const char*& error) {
  static const char* const rootKeys[] = {"schema", "enabled", "loop", "blocks"};
  error = "invalid_program";
  if (!input.is<JsonObjectConst>() || !exactKeys(input.as<JsonObjectConst>(), rootKeys) ||
      !input["schema"].is<int>() || input["schema"].as<int>() != kSchema ||
      !input["enabled"].is<bool>() || !input["loop"].is<bool>() || !input["blocks"].is<JsonArrayConst>() ||
      input["blocks"].as<JsonArrayConst>().size() == 0) return false;
  Program candidate;
  candidate.enabled = input["enabled"].as<bool>();
  candidate.loop = input["loop"].as<bool>();
  if (!decodeList(input["blocks"].as<JsonArrayConst>(), candidate, 1, candidate.root, error) || !validProgram(candidate)) return false;
  output = candidate;  // Invalid data never partially replaces a running program.
  error = nullptr;
  return true;
}

inline void appendList(JsonArray output, const Program& program, uint8_t head) {
  for (uint8_t index = head; index != kNone; index = program.nodes[index].next) {
    const Node& node = program.nodes[index];
    JsonObject object = output.add<JsonObject>();
    switch (node.operation) {
      case Operation::Character:
        object["type"] = "character"; object["value"] = keyring_core::kCharacters[node.value]; break;
      case Operation::Emotion:
        object["type"] = "emotion"; object["value"] = keyring_core::kEmotions[node.value]; break;
      case Operation::Wait:
        object["type"] = "wait"; object["ms"] = node.milliseconds; break;
      case Operation::Weather: object["type"] = "weather"; break;
      case Operation::Repeat:
        object["type"] = "repeat"; object["count"] = node.value;
        appendList(object["blocks"].to<JsonArray>(), program, node.first); break;
      case Operation::IfWeather:
        object["type"] = "ifWeather"; object["kind"] = kWeatherKinds[node.value];
        appendList(object["then"].to<JsonArray>(), program, node.first);
        appendList(object["else"].to<JsonArray>(), program, node.alternative); break;
    }
  }
}

inline bool appendProgram(JsonObject output, const Program& program) {
  if (!validProgram(program)) return false;
  output["schema"] = kSchema;
  output["enabled"] = program.enabled;
  output["loop"] = program.loop;
  appendList(output["blocks"].to<JsonArray>(), program, program.root);
  return true;
}

// The manual scene and saved program form one atomic NVS configuration value.
// Weather remains a separate cache. Version 1 manual settings can still be read
// by the sketch when no version 2 bundle exists.
inline bool appendConfiguration(JsonObject output, const keyring_core::Settings& settings,
                                const Program* program) {
  if (!keyring_core::validSettings(settings) || (program && !validProgram(*program))) return false;
  output["schema"] = 2;
  JsonObject scene = output["settings"].to<JsonObject>();
  scene["character"] = keyring_core::kCharacters[settings.character];
  scene["emotion"] = keyring_core::kEmotions[settings.emotion];
  scene["view"] = keyring_core::kViews[settings.view];
  if (program) return appendProgram(output["program"].to<JsonObject>(), *program);
  output["program"] = nullptr;
  return true;
}

inline bool decodeConfiguration(JsonVariantConst input, keyring_core::Settings& settings,
                                Program& program, bool& haveProgram, const char*& error) {
  static const char* const rootKeys[] = {"schema", "settings", "program"};
  static const char* const settingKeys[] = {"character", "emotion", "view"};
  error = "invalid_configuration";
  if (!input.is<JsonObjectConst>() || !exactKeys(input.as<JsonObjectConst>(), rootKeys) ||
      !input["schema"].is<int>() || input["schema"].as<int>() != 2 || !input["settings"].is<JsonObjectConst>()) return false;
  const JsonObjectConst scene = input["settings"].as<JsonObjectConst>();
  keyring_core::Settings candidateSettings;
  if (!exactKeys(scene, settingKeys) || !plainString(scene["character"]) ||
      !plainString(scene["emotion"]) || !plainString(scene["view"]) ||
      !keyring_core::parseSettings(scene["character"].as<const char*>(), scene["emotion"].as<const char*>(),
                                  scene["view"].as<const char*>(), candidateSettings)) return false;
  Program candidateProgram;
  const bool candidateHaveProgram = !input["program"].isNull();
  if (candidateHaveProgram && !decodeProgram(input["program"], candidateProgram, error)) return false;
  settings = candidateSettings;
  program = candidateProgram;
  haveProgram = candidateHaveProgram;
  error = nullptr;
  return true;
}

}  // namespace keyring_program
