---
id: TASK-287
title: eslint-on-edit.sh runs a synchronous pnpm exec eslint
status: To Do
assignee: []
created_date: '2026-07-17 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:S'
dependencies: []
priority: low
ordinal: 287000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-17 (#1687 r2 observation) — `eslint-on-edit.sh` runs a synchronous `pnpm exec eslint` (binary resolution + flat-config load) on every TS Edit/Write; no debounce or skip-if-recently-linted. Advisory, fail-open, output-bounded — acceptable today. **Fix shape**: debounce by file+mtime. **`--cache` is RULED OUT — measured 2026-07-24 and disproved**: ESLint's cache is keyed on the linted TARGET, and this hook only ever lints the file that was just edited, so the entry is always stale and can never hit (4839/4787/4707ms without vs 4778/4899/4795ms with, target touched each run; the cache is worth ~2.5x only on an UNCHANGED target, which this shape never produces). It was added on that basis and reverted in #1783; `eslint-on-edit.sh` now carries a comment so it isn't re-added. **Promote when**: edit latency becomes noticeable in practice on the Deck.

**Why:** The in-session feedback is worth some latency; a cache/debounce is cheap if the tax ever shows.
<!-- SECTION:DESCRIPTION:END -->
