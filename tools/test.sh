#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/native
tooling="${KEYRING_TOOLING:-$(cd .. && pwd)/.tooling}"
for suite in core renderer program; do
  optimization=-O1
  if [[ "$suite" == program ]]; then optimization=-O0; fi
  "${CXX:-g++}" -std=c++11 -Wall -Wextra -Werror -g "$optimization" \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    -I"$tooling/sketchbook/libraries/ArduinoJson/src" \
    "tests/test_${suite}.cpp" -o ".build/native/test_${suite}"
  ".build/native/test_${suite}"
done
"${CXX:-g++}" -std=c++11 -Wall -Wextra -Werror -O0 \
  -I"$tooling/sketchbook/libraries/ArduinoJson/src" \
  tools/trace_program.cpp -o .build/native/trace_program
node --test tests/test_weather.mjs tests/test_weather_renderer.mjs tests/test_program.mjs tests/test_program_parity.mjs
node tools/vendor_blockly.mjs --check
python3 tools/generate_sprites.py --check
python3 tools/generate_weather_glyphs.py --check
python3 tools/embed_web.py --check
python3 tools/package_arduino.py --check
python3 -m unittest discover -s tests -p 'test_*.py' -v
