#!/usr/bin/env python3
"""One-off analysis: twin/triplet counts and family-size stats, by decade, per contributor.

Not wired into the import pipeline — this is an exploratory report to gauge
whether the numbers are interesting enough to justify a permanent post-import
job + chart. Writes two CSVs and also prints them to stdout.

Definitions used:
  - "Family" = one `families` row (one husband+wife pair + their children_list).
    Same parents is therefore free — no matching/dedup needed.
  - "Multiple birth" = 2+ children of the same family whose birth dates line up:
      * both children have day-level precision (e.g. "20 NOV 1892") -> match
        if their calendar dates are within 2 days of each other (clustered
        with a union-find so triplets etc. group correctly, and so a
        Dec 31 / Jan 1 pair across a year boundary is still caught).
      * otherwise (either side is only a bare year or an approximate date,
        e.g. "ABT 1850") -> match if they share the same birth_year.
    These two groups are clustered independently and NOT merged, so a family
    with e.g. one precisely-dated child and one year-only child sharing that
    year will be undercounted rather than guessed at. Good enough for a first
    read of the data; would need revisiting for a "real" feature.
  - Multiple size 2 = twins, 3 = triplets, 4+ reported as-is (n-tuplets).
  - "Children per family" only considers families with children_list present
    and non-empty (a family with zero listed children tells us nothing about
    family size and would just drag the average down).
  - Decade for a multiple-birth event = decade of the shared birth year.
    Decade for a family-size row = decade of the earliest resolved child
    birth year in that family, falling back to marriage_year, else "unknown".

Usage:
    docker compose exec api python tools/analyze_twins.py
    docker compose exec api python tools/analyze_twins.py --contributor "Novak"
    docker compose exec api python tools/analyze_twins.py --out-dir /app/data/output/twins_report
"""

import argparse
import csv
import os
import re
import statistics
import sys
import time
from collections import defaultdict
from datetime import date

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

try:
    from dotenv import load_dotenv
except ImportError:
    pass

try:
    load_dotenv("../.env")
except Exception:
    pass

if os.getenv("POSTGRES_USER") and os.getenv("POSTGRES_DB"):
    import urllib.parse

    _db_host = os.getenv(
        "POSTGRES_HOST", "db" if os.path.exists("/.dockerenv") else "localhost"
    )
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{urllib.parse.quote(os.getenv('POSTGRES_PASSWORD', ''))}@{_db_host}:5432/{os.getenv('POSTGRES_DB')}"
else:
    DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    os.environ["DATABASE_URL"] = DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ALL_KEY = "__ALL__"

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_FULL_DATE_RE = re.compile(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})")


def _parse_full_date(text_val):
    """Best-effort GEDCOM "DD MON YYYY" -> date(). None if unparseable."""
    if not text_val:
        return None
    m = _FULL_DATE_RE.search(text_val)
    if not m:
        return None
    day, mon, year = m.groups()
    month = _MONTHS.get(mon[:3].upper())
    if not month:
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


FAMILY_ROWS_SQL = text("""
    SELECT id AS family_id, marriage_year,
           jsonb_array_length(children_list) AS children_count
    FROM families
    WHERE contributor = :contributor
      AND children_list IS NOT NULL
      AND children_list <> '[]'::jsonb
""")

CHILD_ROWS_SQL = text("""
    SELECT
        f.id AS family_id,
        p.birth_year AS child_birth_year,
        has_day_precision(p.date_of_birth) AS has_day_precision,
        p.date_of_birth AS child_dob_text
    FROM families f
    CROSS JOIN LATERAL jsonb_array_elements(f.children_list) AS elem(value)
    LEFT JOIN persons p
           ON p.contributor = f.contributor
          AND p.ext_id = COALESCE(elem.value ->> 'id', elem.value ->> 'ext_id')
    WHERE f.contributor = :contributor
      AND f.children_list IS NOT NULL
      AND f.children_list <> '[]'::jsonb
""")


def _decade(year):
    return (year // 10) * 10


def analyze_contributor(db, contributor):
    """Returns (multiple_events, family_size_rows).

    multiple_events: list of dicts {decade, size, method}
    family_size_rows: list of dicts {decade, children_count}
    """
    fam_rows = db.execute(FAMILY_ROWS_SQL, {"contributor": contributor}).fetchall()
    if not fam_rows:
        return [], []

    fam_meta = {r.family_id: r for r in fam_rows}

    children_by_family = defaultdict(list)
    for r in db.execute(CHILD_ROWS_SQL, {"contributor": contributor}).fetchall():
        children_by_family[r.family_id].append(r)

    multiple_events = []
    family_size_rows = []

    for family_id, meta in fam_meta.items():
        children = children_by_family.get(family_id, [])

        # --- family size row ---
        resolved_years = [c.child_birth_year for c in children if c.child_birth_year]
        if resolved_years:
            size_decade = _decade(min(resolved_years))
        elif meta.marriage_year:
            size_decade = _decade(meta.marriage_year)
        else:
            size_decade = None
        family_size_rows.append(
            {"decade": size_decade, "children_count": meta.children_count}
        )

        # --- multiple-birth detection ---
        precise = []  # (index, date)
        imprecise = []  # (index, birth_year)
        for c in children:
            if c.child_birth_year is None:
                continue
            if c.has_day_precision:
                d = _parse_full_date(c.child_dob_text)
                if d is not None:
                    precise.append(d)
                    continue
            imprecise.append(c.child_birth_year)

        if len(precise) >= 2:
            uf = UnionFind(len(precise))
            for i in range(len(precise)):
                for j in range(i + 1, len(precise)):
                    if abs((precise[i] - precise[j]).days) <= 2:
                        uf.union(i, j)
            clusters = defaultdict(list)
            for i, d in enumerate(precise):
                clusters[uf.find(i)].append(d)
            for members in clusters.values():
                if len(members) >= 2:
                    multiple_events.append(
                        {
                            "decade": _decade(members[0].year),
                            "size": len(members),
                            "method": "day",
                        }
                    )

        if len(imprecise) >= 2:
            by_year = defaultdict(int)
            for y in imprecise:
                by_year[y] += 1
            for y, n in by_year.items():
                if n >= 2:
                    multiple_events.append(
                        {"decade": _decade(y), "size": n, "method": "year"}
                    )

    return multiple_events, family_size_rows


def _multiple_label(size):
    return {2: "twins", 3: "triplets", 4: "quadruplets"}.get(size, f"{size}-tuplets")


def write_report(all_results, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    twins_path = os.path.join(out_dir, "twins_by_decade.csv")
    size_path = os.path.join(out_dir, "family_size_by_decade.csv")

    # --- twins_by_decade.csv ---
    twins_agg = defaultdict(lambda: {"day": 0, "year": 0})
    for contributor, (events, _) in all_results.items():
        for e in events:
            key = (contributor, e["decade"], e["size"])
            twins_agg[key][e["method"]] += 1
            all_key = (ALL_KEY, e["decade"], e["size"])
            twins_agg[all_key][e["method"]] += 1

    twins_rows = []
    for (contributor, decade, size), counts in twins_agg.items():
        twins_rows.append(
            {
                "contributor": contributor,
                "decade": decade,
                "multiple_size": size,
                "label": _multiple_label(size),
                "day_precision_events": counts["day"],
                "year_only_events": counts["year"],
                "total_events": counts["day"] + counts["year"],
            }
        )
    twins_rows.sort(key=lambda r: (r["contributor"] != ALL_KEY, r["contributor"], r["decade"], r["multiple_size"]))

    with open(twins_path, "w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "contributor", "decade", "multiple_size", "label",
                "day_precision_events", "year_only_events", "total_events",
            ],
        )
        w.writeheader()
        w.writerows(twins_rows)

    # --- family_size_by_decade.csv ---
    size_agg = defaultdict(list)
    for contributor, (_, rows) in all_results.items():
        for r in rows:
            decade_label = r["decade"] if r["decade"] is not None else "unknown"
            size_agg[(contributor, decade_label)].append(r["children_count"])
            size_agg[(ALL_KEY, decade_label)].append(r["children_count"])

    size_rows = []
    for (contributor, decade), counts in size_agg.items():
        size_rows.append(
            {
                "contributor": contributor,
                "decade": decade,
                "families": len(counts),
                "total_children": sum(counts),
                "avg_children": round(statistics.mean(counts), 2),
                "median_children": statistics.median(counts),
                "max_children": max(counts),
                "min_children": min(counts),
            }
        )
    size_rows.sort(key=lambda r: (r["contributor"] != ALL_KEY, r["contributor"], str(r["decade"])))

    with open(size_path, "w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "contributor", "decade", "families", "total_children",
                "avg_children", "median_children", "max_children", "min_children",
            ],
        )
        w.writeheader()
        w.writerows(size_rows)

    return twins_path, size_path, twins_rows, size_rows


def _print_csv(rows, fieldnames, title):
    print(f"\n=== {title} ===")
    w = csv.DictWriter(sys.stdout, fieldnames=fieldnames)
    w.writeheader()
    w.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="Analyze twin/triplet births and family-size stats by decade."
    )
    parser.add_argument(
        "--contributor",
        metavar="NAME",
        action="append",
        dest="contributors",
        help="Limit to a specific contributor (repeatable). Default: all.",
    )
    parser.add_argument(
        "--out-dir",
        default="/app/data/output/twins_report",
        help="Directory to write the two CSVs to (default: /app/data/output/twins_report)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.contributors:
            names = args.contributors
        else:
            names = [
                r.name
                for r in db.execute(text("SELECT name FROM contributors ORDER BY name")).fetchall()
            ]
        if not names:
            print("No contributors found in database.")
            return

        all_results = {}
        start = time.perf_counter()
        for i, name in enumerate(names, 1):
            t0 = time.perf_counter()
            events, size_rows = analyze_contributor(db, name)
            all_results[name] = (events, size_rows)
            print(
                f"[{i}/{len(names)}] {name}: {len(size_rows)} families, "
                f"{len(events)} multiple-birth event(s) "
                f"({time.perf_counter() - t0:.2f}s)",
                file=sys.stderr,
            )
        print(f"Done in {time.perf_counter() - start:.1f}s total.", file=sys.stderr)

        twins_path, size_path, twins_rows, size_rows = write_report(all_results, args.out_dir)

        _print_csv(
            twins_rows,
            ["contributor", "decade", "multiple_size", "label",
             "day_precision_events", "year_only_events", "total_events"],
            "twins_by_decade",
        )
        _print_csv(
            size_rows,
            ["contributor", "decade", "families", "total_children",
             "avg_children", "median_children", "max_children", "min_children"],
            "family_size_by_decade",
        )
        print(f"\nWritten to:\n  {twins_path}\n  {size_path}", file=sys.stderr)
    finally:
        db.close()


if __name__ == "__main__":
    main()
