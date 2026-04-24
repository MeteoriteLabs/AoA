---
"aoa": patch
---

Windows ship blockers + a11y for v1.0.0-rc.2:

- Memory feature now works on installs without pgvector — conditional `embedding` column + semantic-search fallback to text (Finding J). Goal completion no longer 500s when the memory archive hook fails (Finding S).
- Company import handles the `→` character in the shipped Director playbook under Windows postgres WIN1252 encoding (Finding D).
- Plugin activation now succeeds on Windows with Node 24 — tsx loader passed via `file://` URL instead of raw `C:\` path (Finding N).
- TaskSlideOver wraps Radix Dialog in an accessible screen-reader title and description, silencing the 8+ `DialogContent requires a DialogTitle` console warnings per open (Finding A).
