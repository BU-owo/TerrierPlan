"""
HUB-page pass for catalog IDs that bu_courses_all.csv does not cover.
Read-only: never touches Firestore. Bulletin pages are not fetched.

Fetches bu.edu/hub/hub-courses/ plus its 21 area pages (22 requests, 1 s
apart, no retries; stops on any 429 or non-200), parses every aside.cf-course
card, and emits one CSV row per scripts/courses.new.json ID that is missing
from bu_courses_all.csv and has a card. If only the S variant (e.g. CASWR120S
for CASWR120) has a card, that card is used and the row is marked S-derived.

Usage:
  python3 scripts/scrape-missing.py [--out-dir DIR] [--from-cache]

  --out-dir     Default: ../TerrierPlan-out (sibling of the repo). Refused if
                inside the repo.
  --from-cache  Re-parse the HTML saved by an earlier run; no requests.

Writes to DIR: hub-html/*.html, hub-missing.csv, hub-missing.log.
"""

import csv
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from scrape_bu_courses import HEADERS, HUB_FULL_TO_SHORT  # noqa: E402

INDEX_URL = "https://www.bu.edu/hub/hub-courses/"
EXPECTED_AREAS = 21

# The 19 CSV areas plus the two writing areas the CSV never had.
HUB_NAME_TO_CODE = {
    **HUB_FULL_TO_SHORT,
    "First-Year Writing Seminar": "FYW",
    "Writing, Research, and Inquiry": "WRI",
}

ID_RE = re.compile(r"^([A-Z]{3})\s*([A-Z]{2})\s*(\d+(?:\.\d+)?)([A-Z]*)$")
# "Undergraduate Prerequisites:"; a few cards use lowercase or the singular.
PREREQ_PREFIX_RE = re.compile(r"Undergraduate\s+Prerequisites?:", re.IGNORECASE)

FIELDS = ["id", "matched_card_id", "s_derived", "career", "title",
          "description", "prerequisites", "prereq_split", "hub_units", "areas_seen_on"]


def norm_id(raw: str) -> str | None:
    """'CAS WR 120' / 'CASWR120' -> 'CASWR120' (our Firestore doc ID format)."""
    m = ID_RE.match(re.sub(r"\s+", " ", raw.strip().upper()))
    return "".join(m.groups()) if m else None


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip()


def hub_codes(card, unknown: set) -> list[str]:
    codes = []
    for li in card.select(".cf-hub-offerings li"):
        name = norm_text(li.get_text(" ", strip=True))
        code = HUB_NAME_TO_CODE.get(name)
        if code:
            codes.append(code)
        else:
            unknown.add(name)
    return sorted(set(codes))


def log(msg, fh):
    print(msg)
    fh.write(msg + "\n")


def fetch_all(html_dir: Path, lf) -> list[Path] | None:
    """Index + area pages. Returns saved paths, or None if the run stopped early."""
    session = requests.Session()
    session.headers.update(HEADERS)
    used = 0

    def get(url, name):
        nonlocal used
        if used:
            time.sleep(1)
        used += 1
        resp = session.get(url, timeout=20)
        log(f"GET {resp.status_code} {url}", lf)
        if resp.status_code != 200:
            return None
        p = html_dir / name
        p.write_text(resp.text, encoding="utf-8")
        return p

    index = get(INDEX_URL, "_index.html")
    if index is None:
        log("stopping: index not 200", lf)
        return None
    areas = area_links(index)
    if len(areas) != EXPECTED_AREAS:
        log(f"stopping: expected {EXPECTED_AREAS} area links, found {len(areas)}", lf)
        return None
    saved = []
    for url in areas:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        p = get(url, f"{slug}.html")
        if p is None:
            log(f"stopping after {used} requests (non-200)", lf)
            return None
        saved.append(p)
    log(f"requests used: {used}", lf)
    return saved


def area_links(index_path: Path) -> list[str]:
    soup = BeautifulSoup(index_path.read_text(encoding="utf-8"), "html.parser")
    seen = []
    for a in soup.find_all("a", href=True):
        m = re.search(r"/hub/hub-courses/([a-z0-9-]+)/?$", a["href"])
        if m:
            url = f"{INDEX_URL}{m.group(1)}/"
            if url not in seen:
                seen.append(url)
    return seen


# "Effective Fall 2018, this course fulfills ... BU Hub areas: A, B." Dropped
# from descriptions, as the bulletin scraper does; the areas come from the <li>s.
EFFECTIVE_RE = re.compile(
    r"\s*Effective\s+(?:Fall|Spring|Summer)(?:\s+\d)?\s+\d{4},?\s+[^.]*?fulfil+s"
    r".*?BU\s+Hub\s+areas?:.*?\.(?=\s+[A-Z(]|\s*$)",
    re.IGNORECASE | re.DOTALL,
)
# " - " is the usual prereq/description separator; a few cards use " – " or "-Effective".
DASH_SEP_RE = re.compile(r"\s[-\u2013](?:\s|(?=[A-Z]))")
SENTENCE_END_RE = re.compile(r"(?<!e\.g)(?<!i\.e)(?<!etc)\.\s+(?=[A-Z(])")


def split_prereq(body: str) -> tuple[str, str, str]:
    """-> (prerequisites, description, how). how: dash | sentence | none."""
    pm = PREREQ_PREFIX_RE.search(body)
    if not pm:
        return "", body, "none"
    head, rest = body[:pm.start()], body[pm.end():]
    head = re.sub(r"\s*[-\u2013]\s*$", "", head)
    m = DASH_SEP_RE.search(rest)
    if m:
        return rest[:m.start()].strip(), (head + " " + rest[m.end():]).strip(), "dash"
    # No " - " separator: prereqs end at the first sentence end (heuristic).
    m = SENTENCE_END_RE.search(rest)
    if m:
        return rest[:m.start() + 1].strip(), (head + " " + rest[m.end():]).strip(), "sentence"
    return rest.strip(), head.strip(), "sentence"


def parse_card(card, unknown_hubs: set) -> dict | None:
    """One aside.cf-course -> id, title, description, prerequisites, hub_units."""
    id_el = card.select_one(".cf-course-id")
    cid = norm_id(id_el.get_text(" ", strip=True)) if id_el else None
    if not cid:
        return None
    title_el = card.select_one("h3.bu_collapsible")
    title = norm_text(title_el.get_text(" ", strip=True)) if title_el else ""

    desc_el = card.select_one(".cf-course-description")
    body = norm_text(desc_el.get_text(" ", strip=True)) if desc_el else ""
    prereq, description, how = split_prereq(body)
    if how == "none":
        span = card.select_one(".cf-course-prereqs")
        span_text = norm_text(span.get_text(" ", strip=True)) if span else ""
        if span_text:
            prereq, how = span_text, "span"
    description = norm_text(EFFECTIVE_RE.sub("", description)).strip(" -\u2013")
    return {"id": cid, "title": title, "description": description,
            "prerequisites": prereq, "prereq_split": how,
            "hub_units": hub_codes(card, unknown_hubs)}


def main():
    args = sys.argv[1:]
    out_dir = Path(args[args.index("--out-dir") + 1] if "--out-dir" in args
                   else REPO.parent / "TerrierPlan-out").resolve()
    if out_dir == REPO or REPO in out_dir.parents:
        sys.exit(f"refusing out-dir inside the repo: {out_dir}")
    html_dir = out_dir / "hub-html"
    html_dir.mkdir(parents=True, exist_ok=True)
    lf = open(out_dir / "hub-missing.log", "w", encoding="utf-8")

    if "--from-cache" in args:
        index = html_dir / "_index.html"
        pages = [html_dir / (u.rstrip("/").rsplit("/", 1)[-1] + ".html") for u in area_links(index)]
        log(f"from cache: {len(pages)} area pages, no requests", lf)
    else:
        pages = fetch_all(html_dir, lf)
        if pages is None:
            sys.exit(1)

    # Merge cards across area pages: the same course appears once per area.
    cards: dict[str, dict] = {}
    unparsed = 0
    unknown_hubs: set[str] = set()
    for p in pages:
        soup = BeautifulSoup(p.read_text(encoding="utf-8"), "html.parser")
        page_cards = soup.select("aside.cf-course")
        log(f"{p.stem}: {len(page_cards)} cards", lf)
        for el in page_cards:
            c = parse_card(el, unknown_hubs)
            if not c:
                unparsed += 1
                continue
            prev = cards.get(c["id"])
            if prev is None:
                cards[c["id"]] = {**c, "areas_seen_on": [p.stem]}
                continue
            prev["areas_seen_on"].append(p.stem)
            prev["hub_units"] = sorted(set(prev["hub_units"]) | set(c["hub_units"]))
            if (c["title"], c["description"], c["prerequisites"]) != (
                    prev["title"], prev["description"], prev["prerequisites"]):
                prev["conflicts"] = prev.get("conflicts", 0) + 1
    log(f"distinct card IDs: {len(cards)}; cards without a parseable ID: {unparsed}", lf)
    log(f"unknown HUB labels: {sorted(unknown_hubs) or 'none'}", lf)
    conflicted = [k for k, c in cards.items() if c.get("conflicts")]
    log(f"IDs whose text differs between area pages (first card kept): {len(conflicted)} {conflicted[:10]}", lf)

    catalog = json.load(open(REPO / "scripts" / "courses.new.json"))
    with open(REPO / "bu_courses_all.csv", newline="", encoding="utf-8") as f:
        have = {norm_id(r["Course Number"]) for r in csv.DictReader(f)}
    missing = [k for k in catalog if k not in have]
    log(f"catalog IDs: {len(catalog)}; missing from CSV: {len(missing)}", lf)

    rows = []
    for k in missing:
        card, s_derived = cards.get(k), False
        if card is None and not k.endswith("S") and (k + "S") in cards:
            card, s_derived = cards[k + "S"], True
        if card is None:
            continue
        rows.append({
            "id": k, "matched_card_id": card["id"], "s_derived": s_derived,
            "career": catalog[k].get("career", ""), "title": card["title"],
            "description": card["description"], "prerequisites": card["prerequisites"],
            "prereq_split": card["prereq_split"],
            "hub_units": " ".join(card["hub_units"]),
            "areas_seen_on": " ".join(card["areas_seen_on"]),
        })

    out_csv = out_dir / "hub-missing.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    log(f"rows: {len(rows)} ({sum(r['s_derived'] for r in rows)} S-derived) -> {out_csv}", lf)
    for how in ("dash", "sentence", "span", "none"):
        log(f"  prereq_split={how}: {sum(r['prereq_split'] == how for r in rows)}", lf)
    other = [r["id"] for r in rows if re.search(r"pre-?req", r["description"], re.IGNORECASE)]
    log(f"rows whose description still mentions a prereq label (left as-is): {len(other)} {other[:15]}", lf)
    lf.close()


if __name__ == "__main__":
    main()
