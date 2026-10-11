---
id: TASK-1204
title: >-
  board-commit-branch-gate: exempt the generated conformance snapshot
  (docs/reference/conformance/)
status: To Do
assignee: []
created_date: '2026-10-11 11:07'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm ops surface:inventory --write regenerates docs/reference/conformance/discord-surface.{json,md}, and the pre-push gate requires the refreshed pair in the same commit as the discord.js-adjacent change. When that pair is the only staged change (a snapshot-only follow-up commit on a feature branch), board-commit-branch-gate classifies it as a docs-only board commit and blocks; the documented workaround is TZUROT_ALLOW_BOARD_ON_FEATURE=1, used on a real false positive in the 2026-10-11 session-mining window (2 trips, one session).

What: treat docs/reference/conformance/ as feature-branch content in the gate allowlist (it is generated from code, not board state); sweep any other generated artifacts written under docs/ by ops commands and decide each; update the prose that prescribes the bypass for the conformance pair.

Acceptance: probe row (conformance-only commit on a feature branch passes; conformance plus a tracker file passes as any mixed commit does; tracker-only still blocks); no remaining doc prescribes the bypass for the snapshot.
<!-- SECTION:DESCRIPTION:END -->
