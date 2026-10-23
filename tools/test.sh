#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .build/native
for suite in core renderer; do
  "${CXX:-g++}" -std=c++11 -Wall -Wextra -Werror -g -O1 \
    -fsanitize=address,undefined -fno-omit-frame-pointer \
    "tests/test_${suite}.cpp" -o ".build/native/test_${suite}"
  ".build/native/test_${suite}"
done
node --test tests/test_weather.mjs
python3 tools/generate_sprites.py --check
python3 tools/embed_web.py --check
python3 -m unittest discover -s tests -p 'test_*.py' -v
