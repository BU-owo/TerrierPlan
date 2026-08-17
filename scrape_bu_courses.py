"""
BU Course Bulletin Scraper
Scrapes course info from https://www.bu.edu/academics/
Outputs a CSV with: Course Number, Course Name, Prerequisites, Description,
plus one column per HUB area (X if fulfilled).

HUB area shorthand mapping:
  PLM = Philosophical Inquiry and Life's Meanings
  AEX = Aesthetic Exploration
  HCO = Historical Consciousness
  SI1 = Social Inquiry I
  SI2 = Social Inquiry II
  SO1 = Scientific Inquiry I
  SO2 = Scientific Inquiry II
  QR1 = Quantitative Reasoning I
  QR2 = Quantitative Reasoning II
  IIC = The Individual in Community
  GCI = Global Citizenship and Intercultural Literacy
  ETR = Ethical Reasoning
  WIN = Writing-Intensive Course
  OSC = Oral and/or Signed Communication
  DME = Digital/Multimedia Expression
  CRT = Critical Thinking
  RIL = Research and Information Literacy
  TWC = Teamwork/Collaboration
  CRI = Creativity/Innovation
"""

import requests
from bs4 import BeautifulSoup
import csv
import re
import time
import sys

# ── HUB mapping ─────────────────────────────────────────────────────────────
HUB_FULL_TO_SHORT = {
    "Philosophical Inquiry and Life's Meanings": "PLM",
    "Aesthetic Exploration": "AEX",
    "Historical Consciousness": "HCO",
    "Social Inquiry I": "SI1",
    "Social Inquiry II": "SI2",
    "Scientific Inquiry I": "SO1",
    "Scientific Inquiry II": "SO2",
    "Quantitative Reasoning I": "QR1",
    "Quantitative Reasoning II": "QR2",
    "The Individual in Community": "IIC",
    "Global Citizenship and Intercultural Literacy": "GCI",
    "Ethical Reasoning": "ETR",
    "Writing-Intensive Course": "WIN",
    "Oral and/or Signed Communication": "OSC",
    "Digital/Multimedia Expression": "DME",
    "Critical Thinking": "CRT",
    "Research and Information Literacy": "RIL",
    "Teamwork/Collaboration": "TWC",
    "Creativity/Innovation": "CRI",
}

HUB_COLS = ["PLM", "AEX", "HCO", "SI1", "SI2", "SO1", "SO2",
            "QR1", "QR2", "IIC", "GCI", "ETR", "WIN", "OSC",
            "DME", "CRT", "RIL", "TWC", "CRI"]

FIELDNAMES = ["Course Number", "Course Name", "Prerequisites", "Description"] + HUB_COLS

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# ── BU Schools / college root URLs ──────────────────────────────────────────
# Each value is the root bulletin URL for that school's courses.
# For the demo, only CAS is active. For the full run, uncomment all schools
# (or set demo_mode=False and add them here).
SCHOOLS = {
    "HUB":   "https://www.bu.edu/academics/hub/courses/",
    "CAS":   "https://www.bu.edu/academics/cas/courses/",
    "CFA":   "https://www.bu.edu/academics/cfa/courses/",
    "CGS":   "https://www.bu.edu/academics/cgs/courses/",
    "COM":   "https://www.bu.edu/academics/com/courses/",
    "ENG":   "https://www.bu.edu/academics/eng/courses/",
    "GRS":   "https://www.bu.edu/academics/grs/courses/",
    "KHC":   "https://www.bu.edu/academics/khc/courses/",
    "LAW":   "https://www.bu.edu/academics/law/courses/",
    "MET":   "https://www.bu.edu/academics/met/courses/",
    "QST":   "https://www.bu.edu/academics/questrom/courses/",
    "SAR":   "https://www.bu.edu/academics/sar/courses/",
    "SED":   "https://www.bu.edu/academics/sed/courses/",
    "SHA":   "https://www.bu.edu/academics/sha/courses/",
    "SPH":   "https://www.bu.edu/academics/sph/courses/",
    "SSW":   "https://www.bu.edu/academics/ssw/courses/",
    "STH":   "https://www.bu.edu/academics/sth/courses/",
    "WED":   "https://www.bu.edu/academics/wheelock/courses/",
    "CAMED": "https://www.bu.edu/academics/camed/courses/",
    "CDS":   "https://www.bu.edu/academics/cds/courses/",
    "GMS":   "https://www.bu.edu/academics/gms/courses/",
    "SDM":   "https://www.bu.edu/academics/sdm/courses/",
}

# For demo mode, only scrape CAS (override in __main__ if desired)
DEMO_SCHOOLS = {
    "CAS": "https://www.bu.edu/academics/cas/courses/",
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def get_soup(url: str, retries: int = 3) -> BeautifulSoup | None:
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as e:
            print(f"  [warn] attempt {attempt+1} failed for {url}: {e}", file=sys.stderr)
            time.sleep(2 ** attempt)
    return None


def get_listing_page_count(root_url: str) -> int:
    """Find the highest page number on the course listing index."""
    soup = get_soup(root_url)
    if soup is None:
        return 1
    pagination = soup.select("div.pagination a, .pager a")
    numbers = []
    for a in pagination:
        try:
            numbers.append(int(a.text.strip()))
        except ValueError:
            pass
    # Also scan for /N/ in hrefs
    for a in soup.find_all("a", href=True):
        m = re.search(r"/courses/(\d+)/$", a["href"])
        if m:
            numbers.append(int(m.group(1)))
    return max(numbers) if numbers else 1


def get_course_links_from_listing(listing_url: str) -> list[str]:
    """Return all individual course page URLs from one listing page.

    Individual course pages have slugs like /courses/cas-aa-103/ :
      - school prefix (2-4 letters)  e.g. cas, com, eng
      - department code (2-4 letters) e.g. aa, bi, cs
      - course number (3+ digits)    e.g. 103, 4118
    Department index pages (/courses/african-american-studies/) do NOT match.
    """
    soup = get_soup(listing_url)
    if soup is None:
        return []
    links = []
    # Pattern: /courses/<school>-<dept>-<number>/
    course_slug_re = re.compile(r"/courses/[a-z]{2,4}-[a-z]{2,5}-\d{2,}/", re.IGNORECASE)
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if course_slug_re.search(href):
            full = href if href.startswith("http") else "https://www.bu.edu" + href
            if full not in links:
                links.append(full)
    return links


def parse_course_page(url: str) -> dict | None:
    """Scrape one individual course page and return a row dict."""
    soup = get_soup(url)
    if soup is None:
        return None

    # ── Course number: find h2 matching "SCHOOL DEPT ###" ─────────────────
    course_number = ""
    course_number_tag = None
    for tag in soup.find_all("h2"):
        txt = tag.get_text(strip=True)
        if re.match(r"[A-Z]{2,4}\s+[A-Z]{2,5}\s+\d{2,}", txt):
            course_number = txt
            course_number_tag = tag
            break

    # ── Course name: h1 immediately before the course-number h2 ───────────
    course_name = ""
    if course_number_tag:
        prev_h1 = course_number_tag.find_previous("h1")
        if prev_h1:
            course_name = prev_h1.get_text(strip=True)
    # Fallback: page <title> first segment
    if not course_name:
        title_tag = soup.find("title")
        if title_tag:
            course_name = title_tag.get_text().split("|")[0].strip()

    if not course_number:
        return None   # skip pages that don't look like individual course pages

    # ── HUB areas ─────────────────────────────────────────────────────────
    hub_set: set[str] = set()

    def _hub_match(full_name: str, text: str) -> bool:
        """Word-boundary match so 'Social Inquiry I' never matches 'Social Inquiry II'."""
        return bool(re.search(r"\b" + re.escape(full_name) + r"\b", text, re.IGNORECASE))

    # Strategy 1: cf-hub-offerings element (clean, authoritative badge list)
    hub_offerings = soup.find(class_="cf-hub-offerings")
    if hub_offerings:
        block = hub_offerings.get_text(separator="\n")
        for full_name, short in HUB_FULL_TO_SHORT.items():
            if _hub_match(full_name, block):
                hub_set.add(short)

    # Strategy 2 (fallback): parse last "Effective … BU Hub areas: X, Y" sentence.
    # Only used when cf-hub-offerings is absent. Does NOT combine with Strategy 1.
    if not hub_set:
        full_text = soup.get_text(separator=" ")
        eff_pattern = (
            r"Effective\s+(?:Fall|Spring|Summer)\s+\d{4},\s+this\s+course\s+fulfills"
            r".*?BU\s+Hub\s+areas?:\s*([^.\[\]]+)\."
        )
        matches = re.findall(eff_pattern, full_text, flags=re.IGNORECASE | re.DOTALL)
        if matches:
            area_string = matches[-1]   # use the most recent effective date
            for part in re.split(r"[,;]", area_string):
                part = part.strip()
                for full_name, short in HUB_FULL_TO_SHORT.items():
                    if _hub_match(full_name, part):
                        hub_set.add(short)

    # ── Raw description block (text after the course-number h2) ───────────
    raw_desc = ""
    if course_number_tag:
        # Collect text from siblings/following nodes until we hit a schedule table
        parts = []
        for sib in course_number_tag.find_next_siblings():
            tag_name = sib.name
            # Stop at the schedule section
            if tag_name in ("h4", "h3") and "schedule" in sib.get_text().lower():
                break
            if tag_name == "table":
                break
            text = sib.get_text(separator=" ", strip=True)
            if text:
                parts.append(text)
        raw_desc = " ".join(parts)

    # Clean noise from raw_desc
    # Remove the "Effective Fall XXXX, this course fulfills…" sentences
    raw_desc = re.sub(
        r"Effective\s+(?:Fall|Spring|Summer)\s+\d{4},\s+this\s+course\s+fulfills[^.]*\.",
        "", raw_desc, flags=re.IGNORECASE
    )
    # Remove "Units: 4" and hub icon residue
    raw_desc = re.sub(r"Units?:\s*\d+", "", raw_desc, flags=re.IGNORECASE)
    raw_desc = re.sub(r"\s{2,}", " ", raw_desc).strip()

    # ── Split prerequisites from description ──────────────────────────────
    prereqs = ""
    description = raw_desc

    prereq_match = re.search(
        r"(?:Undergraduate|Graduate)\s+Prerequisites?:\s*(.+?)\s+-\s*",
        raw_desc, flags=re.IGNORECASE
    )
    if prereq_match:
        prereqs = prereq_match.group(1).strip()
        description = raw_desc[prereq_match.end():].strip()

    description = re.sub(r"\s+", " ", description).strip()

    # Remove "BU Hub Learn More" header and any leading HUB area names
    description = re.sub(r"^BU\s+Hub\s+Learn\s+More\s*", "", description, flags=re.IGNORECASE)
    # Strip any leading known HUB area full names (they appear before the actual description)
    all_hub_names = "|".join(re.escape(n) for n in HUB_FULL_TO_SHORT)
    description = re.sub(
        rf"^(?:(?:{all_hub_names})\s*)+", "", description, flags=re.IGNORECASE
    ).strip()
    # Remove trailing schedule fragments like "SPRG 2026 Schedule…" / "FALL 2025 Schedule…"
    description = re.sub(
        r"\s*(?:FALL|FAL|SPRING|SPRG|SUMMER|SUM)\s+\d{4}\s+Sch.*$", "", description,
        flags=re.IGNORECASE | re.DOTALL
    ).strip()
    description = re.sub(
        r"\s*Note that this information.*$", "", description,
        flags=re.IGNORECASE | re.DOTALL
    ).strip()

    # ── Build row ─────────────────────────────────────────────────────────
    row = {
        "Course Number": course_number,
        "Course Name": course_name,
        "Prerequisites": prereqs,
        "Description": description,
    }
    for col in HUB_COLS:
        row[col] = "X" if col in hub_set else ""
    return row


# ── Main ─────────────────────────────────────────────────────────────────────

def scrape(output_csv: str, demo_mode: bool = False, demo_limit: int = 5,
           append_mode: bool = False, schools_override: dict | None = None):
    """
    demo_mode=True     → scrapes only the first `demo_limit` courses from CAS page 1
    demo_mode=False    → scrapes ALL courses from ALL schools in SCHOOLS dict
    append_mode=True   → opens file in append mode (no header written)
    schools_override   → use this dict instead of SCHOOLS/DEMO_SCHOOLS
    """
    if schools_override is not None:
        schools_to_scrape = schools_override
    else:
        schools_to_scrape = DEMO_SCHOOLS if demo_mode else SCHOOLS
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

            courses_written = 0
            seen_urls: set[str] = set()

            for page_url in page_urls:
                print(f"  Listing: {page_url}")
                course_urls = get_course_links_from_listing(page_url)
                print(f"    → {len(course_urls)} courses found")

                for course_url in course_urls:
                    if course_url in seen_urls:
                        continue
                    seen_urls.add(course_url)

                    if demo_mode and courses_written >= demo_limit:
                        break

                    print(f"    Scraping: {course_url}")
                    row = parse_course_page(course_url)
                    if row:
                        writer.writerow(row)
                        f.flush()
                        courses_written += 1
                        print(f"      ✓ {row['Course Number']} – {row['Course Name']}")
                    time.sleep(0.4)   # be polite to BU's servers

                if demo_mode and courses_written >= demo_limit:
                    break

            print(f"  {school}: wrote {courses_written} courses")

    print(f"\nDone! Output: {output_csv}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape BU course bulletin into CSV")
    parser.add_argument(
        "--output", default="bu_courses.csv",
        help="Output CSV filename (default: bu_courses.csv)"
    )
    parser.add_argument(
        "--demo", action="store_true",
        help="Demo mode: scrape only 5 courses to verify output"
    )
    parser.add_argument(
        "--demo-limit", type=int, default=5,
        help="Number of courses to scrape in demo mode (default: 5)"
    )
    parser.add_argument(
        "--append", action="store_true",
        help="Append to existing CSV instead of overwriting (no header written)"
    )
    parser.add_argument(
        "--schools", nargs="+", metavar="KEY=URL",
        help="Override schools to scrape, e.g. --schools SAR=https://... SHA=https://..."
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
