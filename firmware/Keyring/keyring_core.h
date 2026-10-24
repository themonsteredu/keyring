#pragma once

// Portable device rules shared by the Arduino sketch and native tests.
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace keyring_core {

static constexpr uint32_t kMinEpoch = 1704067200UL;  // 2024-01-01 UTC
static constexpr uint32_t kMaxEpoch = 4102444799UL;  // 2099-12-31 UTC
static constexpr uint32_t kFreshSeconds = 3UL * 60UL * 60UL;
static constexpr size_t kHours = 24;
static constexpr size_t kLocationBytes = 96;
static constexpr uint8_t kSchema = 1;

static const char* const kCharacters[] = {"rabbit", "cat", "bear", "turtle", "monster"};
static const char* const kEmotions[] = {"happy", "excited", "sleepy", "sad", "angry", "love"};
static const char* const kViews[] = {"character", "weather", "auto"};

template <size_t N>
inline int findName(const char* value, const char* const (&names)[N]) {
  if (!value) return -1;
  for (size_t i = 0; i < N; ++i) if (std::strcmp(value, names[i]) == 0) return static_cast<int>(i);
  return -1;
}

struct Settings {
  uint8_t character = 0;
  uint8_t emotion = 0;
  uint8_t view = 0;
};

inline bool validSettings(const Settings& settings) {
  return settings.character < 5 && settings.emotion < 6 && settings.view < 3;
}

inline bool parseSettings(const char* character, const char* emotion, const char* view, Settings& result) {
  const int c = findName(character, kCharacters);
  const int e = findName(emotion, kEmotions);
  const int v = findName(view, kViews);
  if (c < 0 || e < 0 || v < 0) return false;
  result.character = static_cast<uint8_t>(c);
  result.emotion = static_cast<uint8_t>(e);
  result.view = static_cast<uint8_t>(v);
  return true;
}

struct ForecastPoint {
  uint32_t time;
  float temperature;
  int16_t code;
  // -1 means a legacy saved forecast did not include relative humidity.
  int16_t humidity;
  ForecastPoint(uint32_t at = 0, float degrees = 0, int16_t weatherCode = 0,
                int16_t relativeHumidity = -1)
      : time(at), temperature(degrees), code(weatherCode), humidity(relativeHumidity) {}
};

enum class WeatherSource : uint8_t { OpenMeteo = 0, Sample = 1 };

struct Weather {
  WeatherSource source = WeatherSource::OpenMeteo;
  char location[kLocationBytes + 1] = {};
  float latitude = 0;
  float longitude = 0;
  uint32_t fetchedAt = 0;
  ForecastPoint current;
  ForecastPoint hourly[kHours];
};

inline bool validEpoch(uint32_t value) { return value >= kMinEpoch && value <= kMaxEpoch; }

inline bool validWeatherCode(int code) {
  switch (code) {
    case 0: case 1: case 2: case 3: case 45: case 48:
    case 51: case 53: case 55: case 56: case 57:
    case 61: case 63: case 65: case 66: case 67:
    case 71: case 73: case 75: case 77:
    case 80: case 81: case 82: case 85: case 86:
    case 95: case 96: case 99: return true;
    default: return false;
  }
}

inline bool validPoint(const ForecastPoint& point) {
  return validEpoch(point.time) && std::isfinite(point.temperature) &&
         point.temperature >= -90.0f && point.temperature <= 65.0f && validWeatherCode(point.code) &&
         point.humidity >= -1 && point.humidity <= 100;
}

inline bool validWeather(const Weather& weather) {
  if (weather.source != WeatherSource::OpenMeteo && weather.source != WeatherSource::Sample) return false;
  if (!std::memchr(weather.location, '\0', sizeof(weather.location)) || weather.location[0] == '\0') return false;
  bool visibleName = false;
  for (size_t i = 0; weather.location[i]; ++i) {
    const unsigned char value = static_cast<unsigned char>(weather.location[i]);
    if (value < 32 || value == 127) return false;
    if (value != ' ') visibleName = true;
  }
  if (!visibleName) return false;
  if (!std::isfinite(weather.latitude) || !std::isfinite(weather.longitude) ||
      weather.latitude < -90 || weather.latitude > 90 || weather.longitude < -180 || weather.longitude > 180) return false;
  if (!validEpoch(weather.fetchedAt) || !validPoint(weather.current)) return false;
  const int64_t currentDifference = static_cast<int64_t>(weather.current.time) - weather.fetchedAt;
  if (currentDifference < -3600 || currentDifference > 300) return false;
  const int64_t firstDifference = static_cast<int64_t>(weather.hourly[0].time) - weather.fetchedAt;
  if (firstDifference < -3600 || firstDifference > 3600) return false;
  for (size_t i = 0; i < kHours; ++i) {
    if (!validPoint(weather.hourly[i])) return false;
    if (i && static_cast<uint64_t>(weather.hourly[i - 1].time) + 3600 != weather.hourly[i].time) return false;
  }
  return true;
}

class Clock {
 public:
  bool synchronize(uint32_t epoch, uint64_t uptimeMs) {
    if (!validEpoch(epoch)) return false;
    epoch_ = epoch;
    uptimeMs_ = uptimeMs;
    trusted_ = true;
    return true;
  }

  bool trusted(uint64_t uptimeMs) const { return trusted_ && uptimeMs >= uptimeMs_ && now64(uptimeMs) <= kMaxEpoch; }

  uint32_t now(uint64_t uptimeMs) const {
    return trusted(uptimeMs) ? static_cast<uint32_t>(now64(uptimeMs)) : 0;
  }

 private:
  uint64_t now64(uint64_t uptimeMs) const { return static_cast<uint64_t>(epoch_) + (uptimeMs - uptimeMs_) / 1000; }
  uint32_t epoch_ = 0;
  uint64_t uptimeMs_ = 0;
  bool trusted_ = false;
};

enum class WeatherStatus : uint8_t { Missing, Sample, ClockUnknown, Stale, Fresh };

inline WeatherStatus weatherStatus(const Weather* weather, const Clock& clock, uint64_t uptimeMs) {
  if (!weather) return WeatherStatus::Missing;
  if (weather->source == WeatherSource::Sample) return WeatherStatus::Sample;
  if (!clock.trusted(uptimeMs)) return WeatherStatus::ClockUnknown;
  const uint32_t now = clock.now(uptimeMs);
  if (static_cast<uint64_t>(now) + 300 < weather->fetchedAt ||
      static_cast<uint64_t>(now) > static_cast<uint64_t>(weather->fetchedAt) + kFreshSeconds ||
      static_cast<uint64_t>(now) + 3600 < weather->hourly[0].time ||
      static_cast<uint64_t>(now) >= static_cast<uint64_t>(weather->hourly[kHours - 1].time) + 3600) return WeatherStatus::Stale;
  return WeatherStatus::Fresh;
}

inline const char* statusName(WeatherStatus status) {
  switch (status) {
    case WeatherStatus::Missing: return "missing";
    case WeatherStatus::Sample: return "sample";
    case WeatherStatus::ClockUnknown: return "clock-unknown";
    case WeatherStatus::Stale: return "stale";
    case WeatherStatus::Fresh: return "fresh";
  }
  return "missing";
}

inline const char* oledStatus(WeatherStatus status) {
  switch (status) {
    case WeatherStatus::Missing: return "NO WEATHER";
    case WeatherStatus::Sample: return "SAMPLE";
    case WeatherStatus::ClockUnknown: return "TIME UNKNOWN";
    case WeatherStatus::Stale: return "OLD FORECAST";
    case WeatherStatus::Fresh: return "SYNCED";
  }
  return "NO WEATHER";
}

enum class Icon : uint8_t { Sun, Cloud, Rain, Snow, Storm, Fog };
inline Icon weatherIcon(int code) {
  if (code == 0 || code == 1) return Icon::Sun;
  if (code == 2 || code == 3) return Icon::Cloud;
  if (code == 45 || code == 48) return Icon::Fog;
  if ((code >= 71 && code <= 77) || code == 85 || code == 86) return Icon::Snow;
  if (code >= 95) return Icon::Storm;
  return Icon::Rain;
}

}  // namespace keyring_core
