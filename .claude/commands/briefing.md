---
description: 1-page briefing on how an area of the repo works, to paste into claude.ai
---
Write a briefing on: $ARGUMENTS

Read the actual code, not docs or commit messages. Don't edit files.

Output: max 1 page, plain markdown, no preamble.
- What it does (2-3 sentences)
- Files involved (path: one-line role)
- Data flow: where data comes from, how it's transformed, where it's stored (Firestore paths/fields)
- Downstream consumers of any shared fields
- Half-built, dead, or inconsistent parts
- Gotchas

Cite file paths. No opinions or recommendations. Mark anything you didn't verify by reading code as "unverified".
