// Native trace of the exact firmware codec and interpreter for JS parity tests.
#include <cstdio>
#include <iostream>
#include <iterator>
#include <string>
#include "../firmware/Keyring/program_codec.h"

int main() {
  const std::string input((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
  JsonDocument document;
  if (input.size() > 65536 || deserializeJson(document, input, DeserializationOption::NestingLimit(20)) ||
      !document["times"].is<JsonArrayConst>()) { std::fprintf(stderr, "invalid trace input\n"); return 2; }
  keyring_program::Program program;
  const char* error = nullptr;
  if (!keyring_program::decodeProgram(document["program"], program, error)) {
    std::fprintf(stderr, "%s\n", error ? error : "invalid program"); return 2;
  }
  keyring_core::Settings base;
  keyring_program::Machine machine;
  if (!machine.start(program, base, 0)) return 2;
  keyring_core::Weather weather;
  const char* kind = document["weather"].as<const char*>();
  const keyring_core::Weather* known = &weather;
  if (kind && std::string(kind) == "sun") weather.current.code = 0;
  else if (kind && std::string(kind) == "cloud") weather.current.code = 3;
  else if (kind && std::string(kind) == "rain") weather.current.code = 61;
  else if (kind && std::string(kind) == "snow") weather.current.code = 71;
  else known = nullptr;
  JsonDocument output;
  JsonArray trace = output.to<JsonArray>();
  for (JsonVariantConst time : document["times"].as<JsonArrayConst>()) {
    if (!time.is<uint64_t>()) { std::fprintf(stderr, "invalid trace time\n"); return 2; }
    const uint64_t now = time.as<uint64_t>();
    machine.tick(now, known);
    const keyring_core::Settings& state = machine.hasOutput() ? machine.rendered() : base;
    JsonObject row = trace.add<JsonObject>();
    row["time"] = now;
    row["running"] = machine.running();
    row["character"] = keyring_core::kCharacters[state.character];
    row["emotion"] = keyring_core::kEmotions[state.emotion];
    row["view"] = keyring_core::kViews[state.view];
  }
  serializeJson(output, std::cout);
  std::cout << '\n';
}
