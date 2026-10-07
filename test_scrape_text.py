"""
Checks scrape_bu_courses.split_description against raw description blocks
taken from real BU course pages (trimmed to their first sentence or two,
plus the page's own "Note that this information..." tail).

Run: python -m unittest test_scrape_text
"""

import unittest

from scrape_bu_courses import HUB_FULL_TO_SHORT, split_description

NOTE = (" Note that this information may change at any time. Please visit the"
        " MyBU Student Portal for the most up-to-date course information.")

# cas-aa-545
CASAA545 = ("Prerequisites: First-Year Writing Seminar (e.g., CASWR 100 or WR 120). - "
            "This course explores the work of eleven Black femme artists, coupled with "
            "theoretical and critical texts written primarily by Black femme thinkers." + NOTE)
# cas-an-522 (SO2): the HUB block comes first.
CASAN522 = ("BU Hub Learn More The Individual in Community Social Inquiry II "
            "Teamwork/Collaboration This course examines how migration shapes and is "
            "shaped by legal status, economic precarity, and racialized and gendered "
            "marginalization." + NOTE)
# cas-an-779
CASAN779 = "This course description is currently under construction." + NOTE
# cfa-th-416: no " - " separator.
CFATH416 = ("Prereq: CFA TH 415 Building on the work of Embodied Skills Lab 1, this course "
            "invites the actor to deepen, own, and trust the foundational and developmental "
            "practices explored throughout the trajectory of Voice and Speech, Movement and "
            "Somatic Practice." + NOTE)
# com-jo-509: the dashes inside the prerequisites are not the separator.
COMJO509 = ("Pre-requisites: Undergrad - COM JO205; Graduate - COM JO710. This course "
            "introduces students to documentary journalism as a form of long-form visual "
            "reporting." + NOTE)


class SplitDescription(unittest.TestCase):
    def test_prerequisites_label(self):
        prereqs, desc = split_description(CASAA545)
        self.assertEqual(prereqs, "First-Year Writing Seminar (e.g., CASWR 100 or WR 120).")
        self.assertTrue(desc.startswith("This course explores the work of eleven"))

    def test_prerequisite_s_label(self):
        # No scraped page uses "Prerequisite(s):" yet, so this is CASAA545
        # with the label swapped.
        raw = CASAA545.replace("Prerequisites:", "Prerequisite(s):", 1)
        prereqs, desc = split_description(raw)
        self.assertEqual(prereqs, "First-Year Writing Seminar (e.g., CASWR 100 or WR 120).")
        self.assertTrue(desc.startswith("This course explores"))

    def test_prereq_without_dash(self):
        prereqs, desc = split_description(CFATH416)
        self.assertEqual(prereqs, "CFA TH 415")
        self.assertTrue(desc.startswith("Building on the work of Embodied Skills Lab 1"))

    def test_dashes_inside_prerequisites(self):
        prereqs, desc = split_description(COMJO509)
        self.assertEqual(prereqs, "Undergrad - COM JO205; Graduate - COM JO710.")
        self.assertTrue(desc.startswith("This course introduces students to documentary"))

    def test_so2_hub_block_leaves_no_stray_i(self):
        prereqs, desc = split_description(CASAN522)
        self.assertEqual(prereqs, "")
        self.assertTrue(desc.startswith("This course examines how migration"), desc[:40])

    def test_every_i_ii_pair_strips_whole(self):
        for name in HUB_FULL_TO_SHORT:
            with self.subTest(name=name):
                _, desc = split_description(f"BU Hub Learn More {name} Critical Thinking This course runs.")
                self.assertEqual(desc, "This course runs.")

    def test_under_construction_placeholder_is_empty(self):
        self.assertEqual(split_description(CASAN779), ("", ""))
        self.assertEqual(split_description("Course description TBD"), ("", ""))

    def test_plain_description_unchanged(self):
        raw = "Examines the fundamental principles of computer architecture." + NOTE
        self.assertEqual(split_description(raw), ("", "Examines the fundamental principles of computer architecture."))


if __name__ == "__main__":
    unittest.main()
