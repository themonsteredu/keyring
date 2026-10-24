// Native parity fixture: emit exactly the packed bytes sent to the OLED.
#include <stdlib.h>
#include <stdio.h>
#include "../firmware/Keyring/weather_renderer.h"

int main(int argc, char** argv) {
  if (argc != 9) return 2;
  const int status = atoi(argv[1]);
  const int page = atoi(argv[2]);
  const int phase = atoi(argv[3]);
  const int code = atoi(argv[4]);
  const float degrees = strtof(argv[5], nullptr);
  const uint32_t received = static_cast<uint32_t>(strtoull(argv[6], nullptr, 10));
  const uint32_t measured = static_cast<uint32_t>(strtoull(argv[7], nullptr, 10));
  const int humidity = atoi(argv[8]);
  keyring_core::Weather weather;
  weather.fetchedAt = received;
  weather.current = keyring_core::ForecastPoint(measured, degrees, static_cast<int16_t>(code), humidity);
  const int codes[] = {0,3,61,73,95,45};
  for (int i = 0; i < 24; ++i)
    weather.hourly[i] = keyring_core::ForecastPoint((received / 3600 + i + 1) * 3600,
                                                  -10.5f + i * 2.5f, codes[i % 6], (i * 7) % 101);
  keyring::FrameBuffer frame;
  keyring::renderWeather(frame, status ? &weather : nullptr,
                        static_cast<keyring_core::WeatherStatus>(status),
                        static_cast<uint8_t>(page), static_cast<uint8_t>(phase));
  return fwrite(frame.data, 1, sizeof(frame.data), stdout) == sizeof(frame.data) ? 0 : 3;
}
