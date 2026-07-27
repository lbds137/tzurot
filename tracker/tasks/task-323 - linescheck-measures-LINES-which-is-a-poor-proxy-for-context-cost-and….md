---
id: TASK-323
title: 'lines:check measures LINES, which is a poor proxy for context cost, and…'
status: To Do
assignee: []
created_date: '2026-07-24 00:00'
labels:
  - 'area:tooling'
  - 'area:ci'
dependencies: []
ordinal: 323000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-24 (context-trim rounds 1–2) — **`lines:check` measures LINES, which is a poor proxy for context cost, and `lines:update-baseline` has no per-surface flag**. Measured: rules average ~72 chars/line; CURRENT.md averaged ~400. The guard therefore rated CURRENT.md "comfortable" at 95/97 while it was the single heaviest always-loaded file in the repo (~9.5k est. tokens — 28% of the whole rules surface). Round 1 cut 122 lines for ~857 est. tokens; round 2 cut 217 lines for ~5,426. Separately, the all-or-nothing baseline refresh means a post-trim `--update` would ratchet `rules` DOWN (2120→1891) but loosen `current` UP (37→73, limit 97→133) in the same write — so the refresh was deliberately NOT run after the trim. **Fix shape**: add a bytes (or est.-token) dimension alongside `lines` in `lines-baseline.json` + the check output, and a `--surface <name>` flag on `lines:update-baseline` so one metric can be ratcheted without loosening another. **Promote when**: the next always-loaded-context trim, or the next time a baseline refresh is wanted for one surface only. **Start**: `packages/tooling/src/…` `lines:check` / `lines:update-baseline`, `.github/baselines/lines-baseline.json`.

**Why:** Not deferred on origin: the guard works as written, but it optimizes the wrong quantity, so it will keep mis-ranking trim targets. Deferred only because the trim it would have guided is already done by hand.
<!-- SECTION:DESCRIPTION:END -->
