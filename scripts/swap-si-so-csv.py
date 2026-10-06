"""
Swaps the SI1<->SO1 and SI2<->SO2 columns' values in a one-hot HUB CSV
(the format scrape_bu_courses.py writes, e.g. bu_courses_all.csv), for files
scraped before the SI/SO mapping fix. Header order is kept; only the values
under those four columns move. Writes a new file, never in place.

Usage:
    python scripts/swap-si-so-csv.py <input.csv> <output.csv>

Refuses if output already exists, is the input file, or the input lacks any
of the four columns. Doesn't handle hub-missing.csv (space-separated
hub_units column, not one-hot).
"""

import csv
import sys
from pathlib import Path

PAIRS = [("SI1", "SO1"), ("SI2", "SO2")]


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    if dst.exists():
        sys.exit(f"Refusing: {dst} already exists.")
    if not src.is_file():
        sys.exit(f"Refusing: {src} not found.")

    with src.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    missing = [c for pair in PAIRS for c in pair if c not in fieldnames]
    if missing:
        sys.exit(f"Refusing: {src} has no column(s) {', '.join(missing)}.")

    def counts() -> dict[str, int]:
        return {c: sum(1 for r in rows if r[c].strip()) for pair in PAIRS for c in pair}

    before = counts()
    changed = 0
    for row in rows:
        old = {c: row[c] for pair in PAIRS for c in pair}
        for a, b in PAIRS:
            row[a], row[b] = row[b], row[a]
        changed += any(row[c] != v for c, v in old.items())
    after = counts()

    with dst.open("x", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Rows: {len(rows)}  changed: {changed}")
    print(f"Before: {before}")
    print(f"After:  {after}")
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
