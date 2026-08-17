"""
BU Instructor/Schedule Scraper
Scrapes the FALL 2026 schedule table(s) from individual BU course pages
(https://www.bu.edu/academics/<school>/courses/<slug>/) and outputs a CSV
with: courseKey, term, classSection, primaryInstructorLastName, location,
scheduleText, notes.

A single course page can have many separate one-row (or few-row) schedule
tables — one per section — each preceded by its own "FALL 2026 Schedule"
<h4>. This script walks each such table independently so rows never bleed
across sections.

URL discovery (SCHOOLS, get_soup, get_listing_page_count,
get_course_links_from_listing) is reused as-is from scrape_bu_courses.py
at the repo root — do not reimplement it here.
"""

import csv
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scrape_bu_courses import (  # noqa: E402
    SCHOOLS,
    DEMO_SCHOOLS,
    get_soup,
    get_listing_page_count,
    get_course_links_from_listing,
)

FIELDNAMES = [
    "courseKey", "term", "classSection",
    "primaryInstructorLastName", "location", "scheduleText", "notes",
]

# Only schedule tables for this term are scraped. Bump this (and re-run)
# once BU rolls the bulletin forward to the next term.
TERM_FILTER = re.compile(r"FALL\s*2026", re.IGNORECASE)

COURSE_NUMBER_RE = re.compile(r"[A-Z]{2,4}\s+[A-Z]{2,5}\s+\d{2,}")

# Header text -> CSV field, matched by substring so column order can vary
# by school without breaking extraction.
HEADER_KEYWORDS = {
    "classSection": "section",
    "primaryInstructorLastName": "instructor",
    "location": "location",
    "scheduleText": "schedule",
    "notes": "notes",
}


def _course_key(course_number: str) -> str:
    """'CAS BI 107' -> 'CASBI107' — matches SCHEMA.md's courseKey rule."""
    return re.sub(r"\s+", "", course_number).upper()


def _term_label(h4_text: str) -> str:
    """'FALL 2026 Schedule' -> 'Fall 2026'"""
    m = re.match(r"([A-Za-z]+)\s+(\d{4})", h4_text.strip())
    if not m:
        return h4_text.strip()
    return f"{m.group(1).capitalize()} {m.group(2)}"


def _column_index(header_cells: list[str]) -> dict[str, int]:
    mapping = {}
    for i, text in enumerate(header_cells):
        lowered = text.strip().lower()
        for field, kw in HEADER_KEYWORDS.items():
            if kw in lowered:
                mapping[field] = i
    return mapping


def parse_instructor_page(url: str) -> list[dict]:
    """Scrape one course page; return one row dict per schedule-table row."""
    soup = get_soup(url)
    if soup is None:
        return []

    course_number = ""
    for tag in soup.find_all("h2"):
        txt = tag.get_text(strip=True)
        if COURSE_NUMBER_RE.match(txt):
            course_number = txt
            break
    if not course_number:
        return []   # not an individual course page
    course_key = _course_key(course_number)

    rows_out = []
    for h4 in soup.find_all("h4"):
        h4_text = h4.get_text(separator=" ", strip=True)
        if "schedule" not in h4_text.lower():
            continue
        if not TERM_FILTER.search(h4_text):
            continue
        table = h4.find_next_sibling("table")
        if table is None:
            continue

        trs = table.find_all("tr")
        if not trs:
            continue
        header_cells = [c.get_text(" ", strip=True) for c in trs[0].find_all(["th", "td"])]
        col = _column_index(header_cells)
        if "classSection" not in col or "primaryInstructorLastName" not in col:
            continue   # not a section-schedule table in the expected shape

        term = _term_label(h4_text)

        for tr in trs[1:]:
            cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
            if not cells:
                continue

            def cell(field: str) -> str:
                idx = col.get(field)
                return cells[idx] if idx is not None and idx < len(cells) else ""

            instructor_raw = cell("primaryInstructorLastName")
            primary_instructor = re.split(r"[,;]", instructor_raw)[0].strip()

            rows_out.append({
                "courseKey": course_key,
                "term": term,
                "classSection": cell("classSection"),
                "primaryInstructorLastName": primary_instructor,
                "location": cell("location"),
                "scheduleText": cell("scheduleText"),
                "notes": cell("notes"),
            })

    return rows_out


# ── Main ─────────────────────────────────────────────────────────────────────

def scrape(output_csv: str, demo_mode: bool = False, demo_limit: int = 5,
           append_mode: bool = False, schools_override: dict | None = None):
    """
    demo_mode=True     -> scrapes only the first `demo_limit` course pages
                           from each school's listing page 1
    demo_mode=False    -> scrapes ALL course pages from ALL listing pages
    append_mode=True   -> opens file in append mode (no header written)
    schools_override   -> use this dict instead of SCHOOLS/DEMO_SCHOOLS
    """
    schools_to_scrape = schools_override if schools_override is not None else (
        DEMO_SCHOOLS if demo_mode else SCHOOLS
    )
    file_mode = "a" if append_mode else "w"
    with open(output_csv, file_mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if not append_mode:
            writer.writeheader()

        for school, root_url in schools_to_scrape.items():
            print(f"\n=== {school} ({root_url}) ===")

            if demo_mode:
                page_urls = [root_url + "1/"]
            else:
                total_pages = get_listing_page_count(root_url)
                print(f"  Found {total_pages} listing pages")
                page_urls = [root_url + str(n) + "/" for n in range(1, total_pages + 1)]

            courses_scraped = 0
            rows_written = 0
            seen_urls: set[str] = set()

            for page_url in page_urls:
                print(f"  Listing: {page_url}")
                course_urls = get_course_links_from_listing(page_url)
                print(f"    -> {len(course_urls)} courses found")

                for course_url in course_urls:
                    if course_url in seen_urls:
                        continue
                    seen_urls.add(course_url)

                    if demo_mode and courses_scraped >= demo_limit:
                        break

                    print(f"    Scraping: {course_url}")
                    rows = parse_instructor_page(course_url)
                    for row in rows:
                        writer.writerow(row)
                    f.flush()
                    courses_scraped += 1
                    rows_written += len(rows)
                    label = rows[0]["courseKey"] if rows else "(no FALL 2026 schedule tables)"
                    print(f"      ✓ {label}: {len(rows)} section rows")
                    time.sleep(0.4)   # be polite to BU's servers

                if demo_mode and courses_scraped >= demo_limit:
                    break

            print(f"  {school}: scraped {courses_scraped} course pages, wrote {rows_written} rows")

    print(f"\nDone! Output: {output_csv}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape BU FALL 2026 instructor/schedule tables into CSV")
    parser.add_argument(
        "--output", default="bu_instructors.csv",
        help="Output CSV filename (default: bu_instructors.csv)"
    )
    parser.add_argument(
        "--demo", action="store_true",
        help="Demo mode: scrape only a handful of course pages to verify output"
    )
    parser.add_argument(
        "--demo-limit", type=int, default=5,
        help="Number of course pages to scrape per school in demo mode (default: 5)"
    )
    parser.add_argument(
        "--append", action="store_true",
        help="Append to existing CSV instead of overwriting (no header written)"
    )
    parser.add_argument(
        "--schools", nargs="+", metavar="KEY=URL",
        help="Override schools to scrape, e.g. --schools CAS=https://www.bu.edu/academics/cas/courses/"
    )
    args = parser.parse_args()

    schools_override = None
    if args.schools:
        schools_override = {}
        for item in args.schools:
            k, v = item.split("=", 1)
            schools_override[k] = v

    scrape(args.output, demo_mode=args.demo, demo_limit=args.demo_limit,
           append_mode=args.append, schools_override=schools_override)
