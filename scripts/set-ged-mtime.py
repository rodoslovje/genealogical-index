"""
set-ged-mtime.py

Sets the modification time of each input/*.GED file to the date recorded in
input/imported-contributors.csv.

CSV format (semicolon-separated, no header):
  <id>;<NAME>;<count>;<YYYY-MM-DD>

Matching is done by comparing the CSV name (column 2) against the GED filename
stem, case-insensitively.

Run from the project root:
  python scripts/set-ged-mtime.py
"""

import csv
import glob
import os
import time
import unicodedata
from datetime import datetime, timezone

INPUT_DIR = "input"
CSV_PATH = os.path.join(INPUT_DIR, "imported-contributors.csv")


def normalize(s):
    """Lowercase + NFC Unicode normalization for consistent matching."""
    return unicodedata.normalize("NFC", s).lower()


def load_dates(csv_path):
    """Returns a dict mapping normalized name -> datetime (noon UTC)."""
    dates = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) < 4:
                continue
            name = normalize(row[1].strip())
            date_str = row[3].strip()
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d").replace(
                    hour=12, tzinfo=timezone.utc
                )
                dates[name] = dt
            except ValueError:
                print(f"WARNING: Could not parse date '{date_str}' for '{row[1]}'")
    return dates


def main():
    if not os.path.isfile(CSV_PATH):
        print(f"ERROR: CSV file not found: {CSV_PATH}")
        return

    dates = load_dates(CSV_PATH)

    ged_files = glob.glob(os.path.join(INPUT_DIR, "*.GED")) + \
                glob.glob(os.path.join(INPUT_DIR, "*.ged"))

    if not ged_files:
        print(f"No .GED/.ged files found in '{INPUT_DIR}'.")
        return

    ged_files.sort()

    for ged_path in ged_files:
        stem = normalize(os.path.splitext(os.path.basename(ged_path))[0])
        dt = dates.get(stem)

        if dt is None:
            print(f"WARNING: No date found in CSV for '{os.path.basename(ged_path)}'")
            continue

        ts = dt.timestamp()
        os.utime(ged_path, (ts, ts))
        print(f"  Set mtime of '{os.path.basename(ged_path)}' to {dt.date()}")

    print("\nDone.")


if __name__ == "__main__":
    main()
