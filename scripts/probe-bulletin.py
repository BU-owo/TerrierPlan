"""
Read-only probe of BU bulletin pages. Never touches Firestore.

Usage:
  python3 scripts/probe-bulletin.py <in.json> <out.json> [--budget N]

in.json:  [{"group": ..., "id": "CASCH205", "url": optional}, ...]
          If "url" is absent, it is built from the id the way the bulletin
          scraper's slugs look: /academics/<school path>/courses/<school>-<dept>-<number>/
out.json: one record per fetched URL, with status and parse_course_page fields.

Each URL is fetched exactly once (no retries), 1 s apart. Stops on a 429 or on
3 consecutive errors (exceptions / 5xx). Output belongs outside the repo.
"""

import json
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])
import scrape_bu_courses as sbc  # noqa: E402

KEY_RE = re.compile(r"^([A-Z]{3})([A-Z]{2})(\d+(?:\.\d+)?)([A-Z]*)$")


def school_path(school: str) -> str:
    # Reuse the scraper's school -> bulletin root mapping (QST -> questrom, WED -> wheelock).
    root = sbc.SCHOOLS.get(school)
    return root.rstrip("/").split("/")[-2] if root else school.lower()


def build_url(course_id: str) -> str | None:
    m = KEY_RE.match(course_id)
    if not m:
        return None
    school, dept, num, suffix = m.groups()
    slug = f"{school}-{dept}-{num}{suffix}".lower()
    return f"https://www.bu.edu/academics/{school_path(school)}/courses/{slug}/"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    budget = int(sys.argv[sys.argv.index("--budget") + 1]) if "--budget" in sys.argv else 40
    items = json.load(open(src))
    results, consecutive_errors, used = [], 0, 0

    for item in items:
        if used >= budget:
            print("budget reached, stopping")
            break
        url = item.get("url") or build_url(item["id"])
        rec = {**item, "url": url}
        if not url:
            rec["status"] = "unbuildable"
            results.append(rec)
            continue
        if used:
            time.sleep(1)
        used += 1
        try:
            resp = requests.get(url, headers=sbc.HEADERS, timeout=20, allow_redirects=True)
            rec["status"] = resp.status_code
            rec["final_url"] = resp.url
        except requests.RequestException as e:
            rec["status"] = f"error: {e}"
            consecutive_errors += 1
            results.append(rec)
            if consecutive_errors >= 3:
                print("3 consecutive errors, stopping")
                break
            continue

        if resp.status_code == 429:
            results.append(rec)
            print("429 received, stopping")
            break
        consecutive_errors = consecutive_errors + 1 if resp.status_code >= 500 else 0

        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            rec["title_tag"] = (soup.title.get_text(strip=True) if soup.title else "")
            # Feed the already-fetched page to the existing parser without a second request.
            sbc.get_soup = lambda _url, _s=soup: _s
            row = sbc.parse_course_page(url)
            if row:
                rec["course_number_h2"] = row["Course Number"]
                rec["name"] = row["Course Name"]
                rec["prereqs"] = row["Prerequisites"]
                rec["description"] = row["Description"][:300]
                rec["hub"] = [c for c in sbc.HUB_COLS if row[c] == "X"]
            else:
                rec["course_number_h2"] = None
        results.append(rec)
        print(f"{rec['status']}  {item.get('group', '')}  {item.get('id', '')}  {url}")
        if consecutive_errors >= 3:
            print("3 consecutive 5xx, stopping")
            break

    json.dump(results, open(dst, "w"), indent=1)
    print(f"requests used: {used}")


if __name__ == "__main__":
    main()
