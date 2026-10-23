#!/usr/bin/env python3
"""Export the exact portable firmware renderer for the offline browser UI."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if atlas is out of date")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="keyring-sprites-") as temp:
        executable = str(Path(temp) / "export-sprites")
        subprocess.run([os.environ.get("CXX", "g++"), "-std=c++11", "-O2",
                        "-Wall", "-Wextra", "-Werror", str(ROOT / "tools/export_sprites.cpp"),
                        "-o", executable], check=True)
        generated = subprocess.check_output([executable])
    destination = ROOT / "web/sprites.json"
    if args.check:
        if not destination.exists() or destination.read_bytes() != generated:
            parser.exit(1, "web/sprites.json is stale; run python3 tools/generate_sprites.py\n")
        print("Character atlas matches all 960 firmware frames.")
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(generated)
        print(f"Generated {destination.relative_to(ROOT)} ({len(generated):,} bytes; 960 frames)")


if __name__ == "__main__":
    main()
