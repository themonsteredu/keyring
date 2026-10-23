#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$repo_dir/tools/setup.py"
cd "$repo_dir"
npm --cache "$repo_dir/.cache/npm" ci
