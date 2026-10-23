#!/usr/bin/env python3
"""Install the pinned Linux x86_64 ESP32-C3 toolchain without global writes.

Only the compiler/libraries required for ESP32-C3 are installed. The official
Espressif archives are checked against its Board Manager checksums. Arduino
tools use release checksums; library sources use pinned commits and SHA-256.
No package-signature, checksum, or TLS verification is disabled.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLING = Path(os.environ.get("KEYRING_TOOLING", ROOT.parent / ".tooling")).resolve()


def checksum(path: Path, algorithm: str) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, algorithm).hexdigest()


def download(item: dict) -> Path:
    destination = TOOLING / "downloads" / item["filename"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    algorithm, expected = item["checksum"].split(":", 1)
    if destination.exists() and checksum(destination, algorithm) == expected:
        return destination
    temporary = destination.with_name(destination.name + ".partial")
    print("Downloading", item["filename"], flush=True)
    with urllib.request.urlopen(item["url"], timeout=180) as response, temporary.open("wb") as out:
        shutil.copyfileobj(response, out, 1024 * 1024)
    if checksum(temporary, algorithm) != expected:
        temporary.unlink()
        raise RuntimeError(f"Checksum mismatch: {item['filename']}")
    temporary.replace(destination)
    return destination


def unpack(archive: Path, destination: Path, strip_root: bool = True) -> None:
    with tempfile.TemporaryDirectory(prefix="extract-", dir=TOOLING) as directory:
        staging = Path(directory)
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as package:
                for member in package.infolist():
                    target = (staging / member.filename).resolve()
                    if not target.is_relative_to(staging):
                        raise RuntimeError("Unsafe archive path")
                package.extractall(staging)
        else:
            with tarfile.open(archive) as package:
                package.extractall(staging, filter="data")
        contents = list(staging.iterdir())
        source = contents[0] if strip_root and len(contents) == 1 and contents[0].is_dir() else staging
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.mkdir(exist_ok=True)
        for entry in source.iterdir():
            target = destination / entry.name
            if target.exists() or target.is_symlink():
                # Preserve pre-existing files. An exact ordinary-file match is reusable.
                if entry.is_file() and target.is_file() and entry.read_bytes() == target.read_bytes():
                    continue
                raise RuntimeError(f"Existing installation differs: {target}; use another KEYRING_TOOLING")
            shutil.move(str(entry), str(target))


def install(item: dict) -> None:
    if item["kind"] == "cli":
        destination = TOOLING / "bin"
    elif item["kind"] == "library":
        destination = TOOLING / "sketchbook" / "libraries" / item["name"]
    else:
        destination = TOOLING / "arduino" / "packages" / item["package"] / item["kind"] / item["name"] / item["version"]
    marker = destination / (".keyring-cli.json" if item["kind"] == "cli" else ".keyring-installed.json")
    if marker.exists() and json.loads(marker.read_text()).get("checksum") == item["checksum"]:
        print("Retained", item["name"], item["version"], flush=True)
        return
    archive = download(item)
    unpack(archive, destination, item.get("strip_root", True))
    marker.write_text(json.dumps({"checksum": item["checksum"]}) + "\n")
    print("Installed", item["name"], item["version"], flush=True)


def main() -> None:
    if sys.version_info < (3, 12):
        raise SystemExit("Python 3.12 or newer is required for safe archive extraction.")
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64"):
        raise SystemExit("This cloud installer supports Linux x86_64; use Arduino IDE Board/Library Managers on other systems.")
    TOOLING.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "tools/dependencies.json").read_text())
    for item in manifest["artifacts"]:
        install(item)
    data = TOOLING / "arduino"
    data.mkdir(exist_ok=True)
    # This isolated installation uses explicitly installed pinned artifacts, not
    # Arduino's package/library managers. Empty optional registry caches prevent
    # CLI startup from trying to update unrelated indexes. They do not suppress
    # compiler checks or replace any tools. Existing registry caches are kept.
    for filename, value in (("package_index.json", {"packages": []}), ("library_index.json", {"libraries": []})):
        path = data / filename
        if not path.exists():
            path.write_text(json.dumps(value) + "\n")
    config = TOOLING / "arduino-cli.yaml"
    config.write_text("directories:\n" + f"  data: {json.dumps(str(data))}\n  downloads: {json.dumps(str(TOOLING / 'downloads'))}\n  user: {json.dumps(str(TOOLING / 'sketchbook'))}\n")
    process_env = {**os.environ, "ARDUINO_DIRECTORIES_DATA": str(data)}
    subprocess.run([str(TOOLING / "bin/arduino-cli"), "--config-file", str(config), "core", "list"], env=process_env, check=True)
    print("Toolchain prepared. Run bash tools/build.sh to compile the ESP32-C3 firmware.")


if __name__ == "__main__":
    main()
