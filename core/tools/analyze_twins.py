#!/usr/bin/env python3
"""One-off analysis: twin/triplet counts and family-size stats, by decade, per contributor.

Not wired into the import pipeline — this is an exploratory report to gauge
whether the numbers are interesting enough to justify a permanent post-import
job + chart. Writes three CSVs to --out-dir:
  - twins_by_decade.csv        aggregated event counts per contributor/decade/size
  - family_size_by_decade.csv  children-per-family stats per contributor/decade
  - multiple_birth_events.csv  one row per individual event (2+), with a
                                family link when --site-url is given
The first two are also printed to stdout; the events file usually has too
many rows for that, so it's only written.

Definitions used:
  - "Family" = one `families` row (one husband+wife pair + their children_list).
    Same parents is therefore free — no matching/dedup needed.
  - "Multiple birth" = 2+ children of the same family whose birth dates have
    day+month precision (e.g. "20 NOV 1892") AND land within 2 days of each
    other (clustered with a union-find so triplets etc. group correctly, and
    so a Dec 31 / Jan 1 pair across a year boundary is still caught). No
    year-only fallback: a bare year, an approximate date (ABT/EST/CAL/BEF/
    AFT/CIRCA/~), or a range (BET...AND, FROM...TO) is excluded outright
    rather than guessed at — those are frequently back-derived estimates
    rather than recorded facts, and a shared estimated year says nothing
    about whether children were actually born together.
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
    docker compose exec api python tools/analyze_twins.py --site-url https://indeks.rodoslovje.si
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
from urllib.parse import urlencode

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

# "Special" non-tree sources (matricula scans, geneanet listings, military
# records) don't represent real family trees, so they have little/no
# families data and would just be noise here. Same convention as crud.py's
# SPECIAL_SUFFIXES.
SPECIAL_SUFFIXES = ("-matricula", "-geneanet", "-military")

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_FULL_DATE_RE = re.compile(r"(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})")

# GEDCOM date ranges/periods ("BET 1935 AND 1942", "FROM 1935 TO 1942") aren't
# caught by the DB's is_approx_date() (no BET/FROM keyword in that regex) and
# can even false-positive has_day_precision() — "35 AND 1942" matches its
# "\d{1,2} word \d{4}" shape, mistaking "AND" for a month. Treated the same
# as an approximate date: excluded outright rather than guessed at.
_RANGE_DATE_RE = re.compile(r"\b(BET|BETWEEN|FROM)\b", re.IGNORECASE)


def _is_range_date(text_val):
    return bool(text_val) and bool(_RANGE_DATE_RE.search(text_val))


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
    -- child_ids: DISTINCT so a literal duplicate entry in children_list
    -- (same child listed twice) doesn't get counted as two births.
    WITH child_ids AS (
        SELECT DISTINCT
            f.id AS family_id,
            COALESCE(elem.value ->> 'id', elem.value ->> 'ext_id') AS child_ext_id
        FROM families f
        CROSS JOIN LATERAL jsonb_array_elements(f.children_list) AS elem(value)
        WHERE f.contributor = :contributor
          AND f.children_list IS NOT NULL
          AND f.children_list <> '[]'::jsonb
    )
    -- persons.ext_id has no uniqueness constraint, so a plain join can fan
    -- out one child into several rows if the ext_id collides with more than
    -- one persons row for this contributor. DISTINCT ON picks a single
    -- (deterministic) match per child so that can't inflate a family's
    -- child count or manufacture fake same-date siblings.
    SELECT DISTINCT ON (ci.family_id, ci.child_ext_id)
        ci.family_id,
        p.birth_year AS child_birth_year,
        has_day_precision(p.date_of_birth) AS has_day_precision,
        is_approx_date(p.date_of_birth) AS is_approx,
        p.date_of_birth AS child_dob_text
    FROM child_ids ci
    LEFT JOIN persons p
           ON p.contributor = :contributor
          AND p.ext_id = ci.child_ext_id
    ORDER BY ci.family_id, ci.child_ext_id, p.id
""")


FAMILY_DETAIL_SQL = text("""
    SELECT id AS family_id, husband_name, husband_surname, husband_birth_year,
           wife_name, wife_surname, wife_birth_year, contributor
    FROM families
    WHERE id = ANY(:ids)
""")


def build_family_url(site_url, fam):
    """fam is a row from FAMILY_DETAIL_SQL. Mirrors the short param names in
    core/web/lib/url.js's PARAM_MAP (hn/hsn/hb/wn/wsn/wb/c)."""
    params = {"t": "family"}
    if fam.husband_name:
        params["hn"] = fam.husband_name
    if fam.husband_surname:
        params["hsn"] = fam.husband_surname
    if fam.husband_birth_year:
        params["hb"] = fam.husband_birth_year
    if fam.wife_name:
        params["wn"] = fam.wife_name
    if fam.wife_surname:
        params["wsn"] = fam.wife_surname
    if fam.wife_birth_year:
        params["wb"] = fam.wife_birth_year
    if fam.contributor:
        params["c"] = fam.contributor
    return f"{site_url.rstrip('/')}/?{urlencode(params)}"


def _decade(year):
    return (year // 10) * 10


def analyze_contributor(db, contributor):
    """Returns (multiple_events, family_size_rows).

    multiple_events: list of dicts {decade, size, family_id, detail}
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
        # Only exact day+month dates count — no year-only fallback. A shared
        # birth_year alone is too weak a signal (sparse-era records often
        # back-fill/estimate a year for several undated siblings), and
        # approximate dates (ABT/EST/CAL/BEF/AFT/CIRCA/~) or ranges
        # (BET...AND, FROM...TO) are excluded outright rather than guessed at.
        precise = []  # date objects
        for c in children:
            if (
                c.child_birth_year is None
                or c.is_approx
                or _is_range_date(c.child_dob_text)
                or not c.has_day_precision
            ):
                continue
            d = _parse_full_date(c.child_dob_text)
            if d is not None:
                precise.append(d)

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
                            "family_id": family_id,
                            "detail": sorted(d.isoformat() for d in members),
                        }
                    )

    return multiple_events, family_size_rows


def _multiple_label(size):
    return {2: "twins", 3: "triplets", 4: "quadruplets"}.get(size, f"{size}-tuplets")


def write_report(all_results, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    twins_path = os.path.join(out_dir, "twins_by_decade.csv")
    size_path = os.path.join(out_dir, "family_size_by_decade.csv")

    # --- twins_by_decade.csv ---
    twins_agg = defaultdict(int)
    for contributor, (events, _) in all_results.items():
        for e in events:
            twins_agg[(contributor, e["decade"], e["size"])] += 1
            twins_agg[(ALL_KEY, e["decade"], e["size"])] += 1

    twins_rows = []
    for (contributor, decade, size), count in twins_agg.items():
        twins_rows.append(
            {
                "contributor": contributor,
                "decade": decade,
                "multiple_size": size,
                "label": _multiple_label(size),
                "events": count,
            }
        )
    twins_rows.sort(key=lambda r: (r["contributor"] != ALL_KEY, r["contributor"], r["decade"], r["multiple_size"]))

    with open(twins_path, "w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["contributor", "decade", "multiple_size", "label", "events"],
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


EVENTS_FIELDNAMES = [
    "contributor", "family_id", "decade", "multiple_size", "label", "dates",
    "husband_name", "husband_surname", "husband_birth_year",
    "wife_name", "wife_surname", "wife_birth_year", "url",
]


def write_events_csv(all_results, fam_details, site_url, out_dir):
    """One row per individual multiple-birth event (2+), not aggregated —
    for spot-checking / sharing / feeding a chart, unlike twins_by_decade.csv
    which only carries per-decade counts."""
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "multiple_birth_events.csv")

    rows = []
    for contributor, (events, _) in all_results.items():
        for e in events:
            fam = fam_details.get(e["family_id"])
            rows.append({
                "contributor": contributor,
                "family_id": e["family_id"],
                "decade": e["decade"],
                "multiple_size": e["size"],
                "label": _multiple_label(e["size"]),
                "dates": ";".join(e["detail"]),
                "husband_name": fam.husband_name if fam else "",
                "husband_surname": fam.husband_surname if fam else "",
                "husband_birth_year": fam.husband_birth_year if fam else "",
                "wife_name": fam.wife_name if fam else "",
                "wife_surname": fam.wife_surname if fam else "",
                "wife_birth_year": fam.wife_birth_year if fam else "",
                "url": build_family_url(site_url, fam) if (fam and site_url) else "",
            })
    rows.sort(key=lambda r: (r["contributor"], r["decade"], -r["multiple_size"]))

    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=EVENTS_FIELDNAMES)
        w.writeheader()
        w.writerows(rows)

    return path, rows


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
    parser.add_argument(
        "--site-url",
        default=None,
        metavar="URL",
        help="Site base URL (e.g. https://indeks.rodoslovje.si) used to build "
        "clickable family links for large (4+) events. Omit to skip link generation.",
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
                if not r.name.endswith(SPECIAL_SUFFIXES)
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

        all_ids = list({
            e["family_id"]
            for _, (events, _) in all_results.items()
            for e in events
        })
        fam_details = {
            r.family_id: r
            for r in db.execute(FAMILY_DETAIL_SQL, {"ids": all_ids}).fetchall()
        } if all_ids else {}

        notable = [
            (contributor, e)
            for contributor, (events, _) in all_results.items()
            for e in events
            if e["size"] >= 3
        ]
        if notable:
            print(
                f"\n{len(notable)} triplet-or-larger event(s) — worth spot-checking:",
                file=sys.stderr,
            )
            for contributor, e in notable:
                line = (
                    f"  {contributor} family_id={e['family_id']} decade={e['decade']} "
                    f"size={e['size']} dates={e['detail']}"
                )
                fam = fam_details.get(e["family_id"])
                if fam and args.site_url:
                    line += f"\n    {build_family_url(args.site_url, fam)}"
                print(line, file=sys.stderr)

        twins_path, size_path, twins_rows, size_rows = write_report(all_results, args.out_dir)
        events_path, events_rows = write_events_csv(
            all_results, fam_details, args.site_url, args.out_dir
        )

        _print_csv(
            twins_rows,
            ["contributor", "decade", "multiple_size", "label", "events"],
            "twins_by_decade",
        )
        _print_csv(
            size_rows,
            ["contributor", "decade", "families", "total_children",
             "avg_children", "median_children", "max_children", "min_children"],
            "family_size_by_decade",
        )
        print(
            f"\n{len(events_rows)} individual multiple-birth event(s) written to {events_path} "
            "(not printed here — open the CSV).",
            file=sys.stderr,
        )
        print(f"\nWritten to:\n  {twins_path}\n  {size_path}\n  {events_path}", file=sys.stderr)
    finally:
        db.close()


if __name__ == "__main__":
    main()
