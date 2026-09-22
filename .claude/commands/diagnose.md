---
description: Diagnose only, no edits. Root cause with evidence.
---
Diagnose only. Do NOT edit any files.

Problem: $ARGUMENTS

1. Find the code path responsible. Read it end to end, including consumers of any data involved.
2. Report:
   - Root cause with file:line evidence
   - Confidence (high/med/low)
   - What you could not determine from code alone
3. If runtime behavior is unclear, don't guess. Give the exact console.log lines to add and what output to send back.
4. List other places the same cause could bite.
5. Sketch the fix in a few sentences, no code. Then stop and wait for my go.
