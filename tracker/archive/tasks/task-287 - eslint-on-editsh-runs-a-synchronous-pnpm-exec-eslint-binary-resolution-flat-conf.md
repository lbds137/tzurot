---
id: TASK-287
title: eslint-on-edit.sh runs a synchronous pnpm exec eslint
status: To Do
assignee: []
created_date: '2026-07-17 00:00'
updated_date: '2026-09-04 20:00'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 287000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-17 (#1687 r2 observation) — `eslint-on-edit.sh` runs a synchronous `pnpm exec eslint` (binary resolution + flat-config load) on every TS Edit/Write; no debounce or skip-if-recently-linted. Advisory, fail-open, output-bounded — acceptable today. **Fix shape**: debounce by file+mtime. **`--cache` is RULED OUT — measured 2026-07-24 and disproved**: ESLint's cache is keyed on the linted TARGET, and this hook only ever lints the file that was just edited, so the entry is always stale and can never hit (4839/4787/4707ms without vs 4778/4899/4795ms with, target touched each run; the cache is worth ~2.5x only on an UNCHANGED target, which this shape never produces). It was added on that basis and reverted in #1783; `eslint-on-edit.sh` now carries a comment so it isn't re-added. **Promote when**: edit latency becomes noticeable in practice on the Deck.

**Why:** The in-session feedback is worth some latency; a cache/debounce is cheap if the tax ever shows.

## MOOT while unregistered 2026-08-07 (#2002)

eslint-on-edit.sh is no longer registered in .claude/settings.json. Its output
went to a channel that never reached the agent (non-blocking PostToolUse,
probed and confirmed for every matcher - TASK-458), so the ~4.8s per edited .ts
file bought nothing at all, and the debounce this task proposes would only have
made a no-op cheaper. lint-staged and CI remain the enforcing gates.

Not archived, because the underlying finding stays valid: IF the hook is ever
re-registered - only on evidence that the delivery channel changed - the
per-edit cost returns and the debounce-by-file+mtime fix shape applies as
written. The --cache ruling above also stands and should not be re-attempted.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:00
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-91 (Idea Hook noise and latency tuning knobs); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-287 finds it.
---
<!-- COMMENTS:END -->
