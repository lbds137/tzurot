---
id: TASK-237
title: 'pnpm quality (pre-commit, on un-prettified source) can disagree with the lint-staged hook…'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
labels: []
dependencies: []
ordinal: 237000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`pnpm quality` (pre-commit, on un-prettified source) can disagree with the lint-staged hook on formatting-sensitive rules — CORRECTED 2026-07-08 after empirical investigation — the original "cwd config divergence / CI is the lenient side" framing was WRONG (disproven: `eslint --print-config` is identical from both cwds; a long-function probe is flagged identically from repo root AND the package dir; `pnpm quality`/turbo catches it too). **Real mechanism**: lint-staged runs `prettier --write` BEFORE `eslint`, so it lints the prettier-EXPANDED code; a manual `pnpm quality` run before committing lints the compact as-written source, so a function near a size limit (e.g. `max-lines-per-function` 100) can pass quality yet fail the hook once prettier wraps it (proven: a 94-line fn → 103 lines post-prettier → warns). **Severity: benign** — NOT a gate hole. Once the prettier-expanded code is committed, CI lints the same expanded form and catches it; the pre-commit hook catches it before commit. The only surprise is a manual pre-commit `pnpm quality` on unformatted source. **Options**: (a) do nothing (expected — run `pnpm quality` after staging/format, or trust the hook); (b) doc note that the hook is authoritative on formatting-sensitive rules. **Promote when**: this actually causes friction. Surfaced 2026-07-08 (release:publish build); mis-diagnosed then corrected same day.

**Why:** It's an ordering artifact, not a CI leniency bug.
<!-- SECTION:DESCRIPTION:END -->
