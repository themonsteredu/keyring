#include <cassert>
#include <cstdio>
#include <string>
#include <vector>
#include "../firmware/Keyring/program_codec.h"

using namespace keyring_program;
static unsigned checks = 0;
#define CHECK(condition) do { assert(condition); ++checks; } while (0)

static bool parse(const std::string& json, Program& program) {
  JsonDocument document;
  if (deserializeJson(document, json, DeserializationOption::NestingLimit(16))) return false;
  const char* error = nullptr;
  return decodeProgram(document.as<JsonVariantConst>(), program, error);
}

static Program fromBlocks(const std::string& blocks, bool loop = false, bool enabled = true) {
  Program program;
  CHECK(parse(std::string("{\"schema\":1,\"enabled\":") + (enabled ? "true" : "false") +
      ",\"loop\":" + (loop ? "true" : "false") + ",\"blocks\":" + blocks + "}", program));
  return program;
}

static std::string encode(const Program& program) {
  JsonDocument document;
  CHECK(appendProgram(document.to<JsonObject>(), program));
  std::string result;
  serializeJson(document, result);
  return result;
}

int main() {
  Program program = fromBlocks("[{\"type\":\"character\",\"value\":\"cat\"},{\"type\":\"repeat\",\"count\":2,\"blocks\":[{\"type\":\"emotion\",\"value\":\"love\"},{\"type\":\"wait\",\"ms\":100},{\"type\":\"emotion\",\"value\":\"sad\"},{\"type\":\"wait\",\"ms\":200}]},{\"type\":\"weather\"}]");
  CHECK(validProgram(program));
  CHECK(program.count == 7);
  keyring_core::Settings base;
  base.view = 2;
  Machine vm;
  CHECK(vm.start(program, base, 0));
  CHECK(vm.running());
  CHECK(vm.tick(0) == 4);
  CHECK(vm.rendered().character == 1 && vm.rendered().emotion == 5 && vm.rendered().view == 0);
  CHECK(vm.waiting() && vm.resumeAt() == 100);
  CHECK(vm.tick(99) == 0);
  CHECK(vm.rendered().emotion == 5);
  CHECK(vm.tick(100) == 2);
  CHECK(vm.rendered().emotion == 3 && vm.resumeAt() == 300);
  vm.tick(300);
  CHECK(vm.rendered().emotion == 5 && vm.resumeAt() == 400);
  vm.tick(400);
  CHECK(vm.rendered().emotion == 3 && vm.resumeAt() == 600);
  vm.tick(600);
  CHECK(!vm.running() && vm.hasOutput() && vm.rendered().view == 1);
  vm.stop();
  CHECK(!vm.hasOutput() && vm.rendered().view == 2 && vm.rendered().character == base.character);

  // Serialization is the actual NVS representation, decoded by the same codec
  // on reboot; enabled=true restarts from the beginning rather than old PC.
  const std::string persisted = encode(program);
  Program restored;
  CHECK(parse(persisted, restored));
  CHECK(encode(restored) == persisted);
  Machine reboot;
  CHECK(reboot.start(restored, base, 500000));
  reboot.tick(500000);
  CHECK(reboot.rendered().emotion == 5 && reboot.resumeAt() == 500100);
  restored.enabled = false;
  const std::string stoppedBlob = encode(restored);
  Program stopped;
  CHECK(parse(stoppedBlob, stopped));
  CHECK(reboot.start(stopped, base, 600000));
  CHECK(!reboot.running() && !reboot.hasOutput());
  stopped.enabled = true;
  CHECK(reboot.start(stopped, base, 600000));
  reboot.tick(600000);
  CHECK(reboot.running() && reboot.rendered().emotion == 5);

  // A 32-bit millis rollover does not shorten a scheduled wait.
  const uint64_t nearWrap = UINT64_C(0xfffffff0);
  CHECK(vm.start(program, base, nearWrap));
  vm.tick(nearWrap);
  CHECK(vm.resumeAt() == nearWrap + 100);
  CHECK(vm.tick(nearWrap + 99) == 0);
  vm.tick(nearWrap + 100);
  CHECK(vm.rendered().emotion == 3 && vm.resumeAt() == nearWrap + 300);
  vm.tick(nearWrap - 1);
  CHECK(!vm.running() && !vm.hasOutput());

  Program condition = fromBlocks("[{\"type\":\"ifWeather\",\"kind\":\"rain\",\"then\":[{\"type\":\"character\",\"value\":\"turtle\"}],\"else\":[{\"type\":\"ifWeather\",\"kind\":\"snow\",\"then\":[{\"type\":\"emotion\",\"value\":\"love\"}],\"else\":[{\"type\":\"character\",\"value\":\"bear\"}]}]}]");
  keyring_core::Weather weather;
  weather.current.code = 61;
  weather.source = keyring_core::WeatherSource::Sample;
  CHECK(vm.start(condition, base, 0)); vm.tick(0, &weather);
  CHECK(vm.rendered().character == 3 && !vm.running());
  weather.current.code = 95;
  CHECK(vm.start(condition, base, 0)); vm.tick(0, &weather);
  CHECK(vm.rendered().character == 3);
  weather.current.code = 85;
  CHECK(vm.start(condition, base, 0)); vm.tick(0, &weather);
  CHECK(vm.rendered().emotion == 5);
  CHECK(vm.start(condition, base, 0)); vm.tick(0, nullptr);
  CHECK(vm.rendered().character == 2);
  weather.current.code = -1;
  CHECK(classifyWeather(&weather) == WeatherKind::Unknown);
  weather.current.code = 48;
  CHECK(classifyWeather(&weather) == WeatherKind::Cloud);

  // No-wait loops yield, and every tick has a hard instruction budget.
  Program loop = fromBlocks("[{\"type\":\"emotion\",\"value\":\"excited\"}]", true);
  CHECK(vm.start(loop, base, 0));
  CHECK(vm.tick(0) == 2 && vm.resumeAt() == 100);
  CHECK(vm.tick(99) == 0);
  CHECK(vm.tick(100) == 2 && vm.resumeAt() == 200);
  Program waitLoop = fromBlocks("[{\"type\":\"wait\",\"ms\":100}]", true);
  CHECK(vm.start(waitLoop, base, 0));
  vm.tick(0); vm.tick(100);
  CHECK(vm.resumeAt() == 200);

  std::string sixtyFour = "[";
  for (unsigned i = 0; i < 64; ++i) { if (i) sixtyFour += ','; sixtyFour += "{\"type\":\"emotion\",\"value\":\"angry\"}"; }
  sixtyFour += ']';
  Program full = fromBlocks(sixtyFour);
  CHECK(full.count == 64 && validProgram(full));
  CHECK(vm.start(full, base, 0));
  for (unsigned i = 0; i < 4; ++i) CHECK(vm.tick(i) == kOperationsPerTick && vm.running());
  CHECK(vm.tick(4) == 1 && !vm.running());
  Program nested = fromBlocks("[{\"type\":\"repeat\",\"count\":20,\"blocks\":[{\"type\":\"repeat\",\"count\":20,\"blocks\":[{\"type\":\"repeat\",\"count\":20,\"blocks\":[{\"type\":\"emotion\",\"value\":\"love\"}]}]}]}]");
  CHECK(vm.start(nested, base, 0));
  unsigned ticks = 0;
  while (vm.running() && ticks < 2000) { CHECK(vm.tick(ticks) <= kOperationsPerTick); ++ticks; }
  CHECK(!vm.running() && ticks > 100 && ticks < 2000);
  CHECK(vm.rendered().emotion == 5);
  Program emptyNested = fromBlocks("[{\"type\":\"repeat\",\"count\":20,\"blocks\":[]},{\"type\":\"ifWeather\",\"kind\":\"sun\",\"then\":[],\"else\":[]}]");
  CHECK(vm.start(emptyNested, base, 0));
  CHECK(vm.tick(0) == 3 && !vm.running());

  // Reject corrupt or hostile programs while preserving a prior valid output.
  const std::string invalids[] = {
    "{}", "[]", "{not-json}",
    "{\"schema\":2,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"weather\"}]}",
    "{\"schema\":1,\"enabled\":1,\"loop\":false,\"blocks\":[{\"type\":\"weather\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[],\"code\":\"evil()\"}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"weather\",\"value\":\"sun\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"eval\",\"code\":\"evil()\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"character\",\"value\":\"fox\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"emotion\",\"value\":\"wow\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"wait\",\"ms\":99}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"wait\",\"ms\":30001}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"wait\",\"ms\":100.5}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"repeat\",\"count\":0,\"blocks\":[]}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"repeat\",\"count\":21,\"blocks\":[]}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"ifWeather\",\"kind\":\"unknown\",\"then\":[],\"else\":[]}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"ifWeather\",\"kind\":\"sun\",\"then\":[],\"else\":[],\"javascript\":\"evil()\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"weather\\u0000extra\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"character\",\"value\":\"cat\\u0000extra\"}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"ifWeather\",\"kind\":\"rain\\u0000extra\",\"then\":[],\"else\":[]}]}",
    "{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":[{\"type\":\"weather\",\"type\\u0000extra\":\"weather\"}]}"
  };
  const std::string prior = encode(program);
  for (const std::string& invalid : invalids) { CHECK(!parse(invalid, program)); CHECK(encode(program) == prior); }
  const std::string tooMany = sixtyFour.substr(0, sixtyFour.size() - 1) + ",{\"type\":\"weather\"}]";
  CHECK(!parse("{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":" + tooMany + "}", program));
  const std::string tooDeep = "[{\"type\":\"repeat\",\"count\":1,\"blocks\":[{\"type\":\"repeat\",\"count\":1,\"blocks\":[{\"type\":\"repeat\",\"count\":1,\"blocks\":[{\"type\":\"repeat\",\"count\":1,\"blocks\":[{\"type\":\"weather\"}]}]}]}]}]";
  CHECK(!parse("{\"schema\":1,\"enabled\":true,\"loop\":false,\"blocks\":" + tooDeep + "}", program));
  Program cyclic = loop;
  cyclic.nodes[0].next = 0;
  CHECK(!validProgram(cyclic) && !vm.start(cyclic, base, 0));
  cyclic = loop;
  cyclic.nodes[0].next = 64;
  CHECK(!validProgram(cyclic));
  cyclic = loop;
  cyclic.count = 0;
  CHECK(!validProgram(cyclic));

  // A single configuration blob is the persistence boundary for BOTH the
  // manual scene and program state; decoding any corrupt half changes neither.
  keyring_core::Settings scene;
  CHECK(keyring_core::parseSettings("turtle", "love", "auto", scene));
  Program bundledProgram = restored;
  bundledProgram.enabled = true;
  JsonDocument bundle;
  CHECK(appendConfiguration(bundle.to<JsonObject>(), scene, &bundledProgram));
  std::string bundleBlob;
  serializeJson(bundle, bundleBlob);
  JsonDocument loaded;
  CHECK(!deserializeJson(loaded, bundleBlob, DeserializationOption::NestingLimit(16)));
  keyring_core::Settings loadedScene;
  Program loadedProgram;
  bool hasProgram = false;
  const char* bundleError = nullptr;
  CHECK(decodeConfiguration(loaded.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  CHECK(hasProgram && loadedProgram.enabled && loadedScene.character == 3 && loadedScene.emotion == 5 && loadedScene.view == 2);
  CHECK(encode(loadedProgram) == encode(bundledProgram));
  const std::string goodProgram = encode(loadedProgram);
  loaded["settings"]["character"] = "invalid";
  CHECK(!decodeConfiguration(loaded.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  CHECK(loadedScene.character == 3 && hasProgram && encode(loadedProgram) == goodProgram);
  CHECK(!deserializeJson(loaded, bundleBlob, DeserializationOption::NestingLimit(16)));
  loaded["settings"]["character"] = "cat";
  loaded["program"]["schema"] = 999;
  CHECK(!decodeConfiguration(loaded.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  CHECK(loadedScene.character == 3 && hasProgram && encode(loadedProgram) == goodProgram);
  bundle.clear();
  bundledProgram.enabled = false;
  CHECK(appendConfiguration(bundle.to<JsonObject>(), scene, &bundledProgram));
  CHECK(decodeConfiguration(bundle.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  CHECK(hasProgram && !loadedProgram.enabled);
  CHECK(reboot.start(loadedProgram, loadedScene, 0) && !reboot.running());
  bundle.clear();
  CHECK(appendConfiguration(bundle.to<JsonObject>(), base, nullptr));
  CHECK(decodeConfiguration(bundle.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  CHECK(!hasProgram && loadedScene.character == base.character && loadedScene.view == base.view);
  bundle["unexpected"] = true;
  CHECK(!decodeConfiguration(bundle.as<JsonVariantConst>(), loadedScene, loadedProgram, hasProgram, bundleError));
  std::printf("program: %u assertions passed (strict codec, VM timing, branches, limits, reboot round-trip)\n", checks);
}
