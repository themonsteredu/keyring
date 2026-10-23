#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tooling="${KEYRING_TOOLING:-$(cd .. && pwd)/.tooling}"
export ARDUINO_DIRECTORIES_DATA="$tooling/arduino"
node tools/vendor_blockly.mjs
python3 tools/generate_sprites.py
python3 tools/embed_web.py
"$tooling/bin/arduino-cli" --config-file "$tooling/arduino-cli.yaml" compile \
  --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,FlashSize=4M,PartitionScheme=huge_app \
  --jobs 4 --warnings default --build-path "$PWD/.build/esp32c3" \
  --output-dir "$PWD/.build/firmware" firmware/Keyring
python3 tools/package_arduino.py
