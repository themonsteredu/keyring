#include "../firmware/Keyring/keyring_core.h"
#include <cassert>
#include <cstdio>
#include <initializer_list>
#include <limits>

using namespace keyring_core;

static Weather fixture() {
  Weather result;
  std::strcpy(result.location, "Seoul");
  result.latitude = 37.57f;
  result.longitude = 126.98f;
  result.fetchedAt = 1770000000;
  result.current = {result.fetchedAt, 12.5f, 1};
  for (size_t i = 0; i < kHours; ++i) result.hourly[i] = {result.fetchedAt + static_cast<uint32_t>(i) * 3600, 10.0f, 3};
  return result;
}

int main() {
  unsigned assertions = 0;
#define CHECK(condition) do { assert(condition); ++assertions; } while (0)
  Settings settings;
  CHECK(validSettings(settings));
  CHECK(parseSettings("turtle", "love", "weather", settings));
  CHECK(settings.character == 3 && settings.emotion == 5 && settings.view == 1);
  CHECK(!parseSettings("rabbit", "surprised", "auto", settings));
  CHECK(!parseSettings(nullptr, "happy", "auto", settings));
  settings.character = 255;
  CHECK(!validSettings(settings));

  Weather weather = fixture();
  CHECK(validWeather(weather));
  Weather bad = weather;
  bad.hourly[12].time += 1;
  CHECK(!validWeather(bad));
  bad = weather;
  bad.hourly[0].code = 4;
  CHECK(!validWeather(bad));
  bad = weather;
  bad.current.temperature = std::numeric_limits<float>::quiet_NaN();
  CHECK(!validWeather(bad));
  bad = weather;
  bad.latitude = 91;
  CHECK(!validWeather(bad));
  bad = weather;
  bad.current.time -= 3601;
  CHECK(!validWeather(bad));
  bad = weather;
  bad.hourly[0].temperature = 65.01f;
  CHECK(!validWeather(bad));
  bad = weather;
  std::memset(bad.location, 'a', sizeof(bad.location));
  CHECK(!validWeather(bad));
  bad = weather;
  std::strcpy(bad.location, "Seoul\n");
  CHECK(!validWeather(bad));
  bad = weather;
  std::strcpy(bad.location, "   ");
  CHECK(!validWeather(bad));
  bad = weather;
  std::strcpy(bad.location, "Seoul\x7f");
  CHECK(!validWeather(bad));
  bad = weather;
  bad.fetchedAt = kMinEpoch - 1;
  CHECK(!validWeather(bad));
  bad = weather;
  bad.source = static_cast<WeatherSource>(2);
  CHECK(!validWeather(bad));
  for (int code : {0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99}) CHECK(validWeatherCode(code));
  CHECK(!validWeatherCode(-1));
  CHECK(!validWeatherCode(100));

  Clock clock;
  CHECK(!clock.trusted(0));
  CHECK(clock.now(0) == 0);
  CHECK(weatherStatus(nullptr, clock, 0) == WeatherStatus::Missing);
  CHECK(weatherStatus(&weather, clock, 0) == WeatherStatus::ClockUnknown);
  CHECK(!clock.synchronize(kMinEpoch - 1, 0));
  CHECK(clock.synchronize(weather.fetchedAt, 500));
  CHECK(clock.now(1500) == weather.fetchedAt + 1);
  CHECK(!clock.trusted(499));
  CHECK(weatherStatus(&weather, clock, 500) == WeatherStatus::Fresh);
  CHECK(weatherStatus(&weather, clock, 500 + uint64_t(kFreshSeconds) * 1000) == WeatherStatus::Fresh);
  CHECK(weatherStatus(&weather, clock, 1500 + uint64_t(kFreshSeconds) * 1000) == WeatherStatus::Stale);
  // esp_timer-backed uint64 time continues correctly beyond the 32-bit millis wrap.
  CHECK(clock.synchronize(weather.fetchedAt, UINT64_C(0xfffffff0)));
  CHECK(clock.now(UINT64_C(0x1000003d8)) == weather.fetchedAt + 1);
  CHECK(clock.synchronize(weather.fetchedAt - 301, 0));
  CHECK(weatherStatus(&weather, clock, 0) == WeatherStatus::Stale);
  Weather sample = weather;
  sample.source = WeatherSource::Sample;
  Clock rebootedClock;
  CHECK(weatherStatus(&sample, rebootedClock, 0) == WeatherStatus::Sample);
  CHECK(weatherStatus(&weather, rebootedClock, 0) == WeatherStatus::ClockUnknown);
  CHECK(std::strcmp(statusName(WeatherStatus::ClockUnknown), "clock-unknown") == 0);
  CHECK(clock.synchronize(kMaxEpoch, 0));
  CHECK(!clock.trusted(1000));
  CHECK(weatherIcon(0) == Icon::Sun);
  CHECK(weatherIcon(3) == Icon::Cloud);
  CHECK(weatherIcon(61) == Icon::Rain);
  CHECK(weatherIcon(85) == Icon::Snow);
  CHECK(weatherIcon(95) == Icon::Storm);
  CHECK(weatherIcon(45) == Icon::Fog);
  std::printf("core: %u assertions passed\n", assertions);
}
