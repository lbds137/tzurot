---
id: TASK-1227
title: >-
  Split render drops the character side entirely for memories with no done
  summary
status: To Do
assignee: []
created_date: '2026-10-13 01:26'
updated_date: '2026-10-16 06:24'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1216000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split render drops the character side for memories with no done summary. RENDER HALF SHIPPED 2026-10-16: PR #2622 merged after 6 review rounds (capped 700-char assistantTurn excerpt, own notes only, foreign+chunk exclusions, wiring-tested seam, instruction + spec rows MEM-ARCH-002/038 amended, D2 reversal recorded in memory-archive-format.md). Part 3 state (record: docs/local/emily-eval/rec2-followup.md): (a) DONE 2026-10-16 — both fallback arms runtime-confirmed on real dev rows through the merged code (dead no_template row → legacy verbatim fallback; never-summarized parseable row e3fe4469 → MEM-ARCH-038 excerpt, cap exact at 701 incl. marker); caveat: dev has no parseable dead row, so the excerpt arm was confirmed on a null-status row (same hasSummary=false path per code) — a prod parseable dead row through the release-day sweep closes it. (b) DONE 2026-10-16 — cause recorded (recall never filters summary state — PgvectorQueryBuilder.buildWhereConditions; pre-bump MEM-ARCH-022 excluded dead-at-current-version so they were permanently stuck; the v2 bump is the re-admission) + prod classes (owner-ran dead-classes.mjs): 52 dead, all recalled — 41 no_template (0 attempts, unparseable, render the legacy fallback arm), 10 first_person + 1 parse_failure (3 billed strikes each, v2 bump re-admits them; v2's first-person carve-out is the plausible fix for the 10). (c) RELEASE-GATED: prod needs the v2 deploy first (pre-release = v1 code processes jobs + done@v1 re-swept = double spend); dev rehearsal DONE 2026-10-16 (206 hot jobs enqueued: 114 done@v1 + 6 failed + 1 dead + 85 never, ~449k est input tokens; outcome in rec2-followup.md); release-day command: `pnpm ops memory:summarize --env prod --personality emily-tzudad-seraph-ditza --window 40` (window 40 covers the eval window; no --include-cold). Review residue filed: TASK-1235 (unlabeled-excerpt speaker ambiguity), TASK-1236 (test precision batch + code-units wording); beta.237 watch: excerptNotes share vs the ~13% no-summary share.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-10-12 (AskUserQuestion): YES, capped verbatim excerpt of the character turn when no summary exists. The doc-8 'null never renders verbatim once switched on' ruling was about summarized rows; write this exception and its reason into memory-archive-format.md in the same PR.
<!-- SECTION:NOTES:END -->
