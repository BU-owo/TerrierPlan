"""
Checks scrape_bu_courses.HUB_FULL_TO_SHORT against HUB_LABELS in
src/utils/hubConstants.js so the scraper's codes and the app's labels
can't drift apart (they once had SI/SO swapped).

Run: python -m unittest test_hub_map
"""

import re
import unittest
from pathlib import Path

from scrape_bu_courses import HUB_FULL_TO_SHORT

HUB_CONSTANTS = Path(__file__).parent / "src" / "utils" / "hubConstants.js"


def load_hub_labels() -> dict[str, str]:
    src = HUB_CONSTANTS.read_text(encoding="utf-8")
    block = re.search(r"export const HUB_LABELS = \{(.*?)\};", src, re.DOTALL)
    assert block, "HUB_LABELS not found in hubConstants.js"
    entries = re.findall(
        r"^\s*([A-Z0-9]{3}):\s*(?:'([^']*)'|\"([^\"]*)\")", block.group(1), re.MULTILINE
    )
    return {code: single or double for code, single, double in entries}


def norm(label: str) -> str:
    # The app abbreviates "and" to "&" in two labels.
    return re.sub(r"\s+", " ", label.replace("&", "and")).strip().lower()


class HubMapMatchesApp(unittest.TestCase):
    def test_every_scraper_code_has_the_app_label(self):
        labels = load_hub_labels()
        for full_name, code in HUB_FULL_TO_SHORT.items():
            with self.subTest(code=code):
                self.assertIn(code, labels, f"{code} missing from HUB_LABELS")
                self.assertEqual(norm(full_name), norm(labels[code]))

    def test_codes_are_unique(self):
        codes = list(HUB_FULL_TO_SHORT.values())
        self.assertEqual(len(codes), len(set(codes)))


if __name__ == "__main__":
    unittest.main()
