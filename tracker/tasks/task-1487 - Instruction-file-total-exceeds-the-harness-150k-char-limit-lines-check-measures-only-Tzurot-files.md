---
id: TASK-1487
title: >-
  Instruction-file total exceeds the harness 150k-char limit; lines:check
  measures only Tzurot files
status: To Do
assignee: []
created_date: '2026-11-21T00:26:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1487000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: at session start on 2026-11-20 the harness warned "13 instruction files add up to 150.8k chars, over the 150.0k-char total limit" (largest: .claude/rules/05-tooling.md 25.0k, seyag core.md 22.0k, .claude/rules/10-working-posture.md 16.5k). pnpm ops lines:check reported instructions 123909 chars vs its 147000 ceiling the same evening because it counts only CLAUDE.md + .claude/rules, not the user-level and plugin files the harness also loads. Over the limit, content may be truncated or dropped (unverified). Relayed by Deck; seyag core.md trimming is seyag-owned.

What: (1) trim Tzurot rules (05-tooling, 10-working-posture first) per the /tzurot-doc-audit economy pass; (2) make the ceiling account for the non-Tzurot share, e.g. a Tzurot ceiling of 150000 minus the measured external files, or a check that sums the full set when present.

Acceptance: the startup warning is gone, and lines:check fails when the full set would exceed 150000.
<!-- SECTION:DESCRIPTION:END -->
