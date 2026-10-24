#!/usr/bin/env python3
"""Package the complete Arduino IDE sketch as a deterministic download ZIP."""
import argparse
import hashlib
import io
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "firmware" / "Keyring"
DESTINATION = ROOT / "downloads" / "Keyring-Arduino.zip"
FILES = ("Keyring.ino", "character_renderer.h", "keyring_core.h", "program_core.h", "program_codec.h",
         "weather_renderer.h", "weather_glyphs.h", "weather_font_license.txt", "web_assets.h")
TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def create_archive():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for filename in FILES:
            entry = zipfile.ZipInfo(f"Keyring/{filename}", date_time=TIMESTAMP)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (SOURCE / filename).read_bytes(), compresslevel=9)
    return buffer.getvalue()


def verify_archive(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("ZIP CRC verification failed")
        expected = [f"Keyring/{filename}" for filename in FILES]
        if archive.namelist() != expected:
            raise RuntimeError("Archive must contain exactly the sketch and all required headers")
        for filename in FILES:
            entry = archive.getinfo(f"Keyring/{filename}")
            if entry.date_time != TIMESTAMP or (entry.external_attr >> 16) & 0o777 != 0o644:
                raise RuntimeError("Unexpected ZIP metadata")
            if archive.read(entry) != (SOURCE / filename).read_bytes():
                raise RuntimeError(f"Archive source mismatch: {filename}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the downloadable ZIP is stale")
    args = parser.parse_args()
    generated = create_archive()
    verify_archive(generated)
    if args.check:
        if not DESTINATION.is_file() or DESTINATION.read_bytes() != generated:
            parser.exit(1, "Download ZIP is stale; run python3 tools/package_arduino.py\n")
        verify_archive(DESTINATION.read_bytes())
        action = "Verified"
    else:
        DESTINATION.parent.mkdir(parents=True, exist_ok=True)
        DESTINATION.write_bytes(generated)
        action = "Created"
    print(f"{action} {DESTINATION.relative_to(ROOT)} ({len(generated):,} bytes)")
    print(f"SHA-256: {hashlib.sha256(generated).hexdigest()}")


if __name__ == "__main__":
    main()
