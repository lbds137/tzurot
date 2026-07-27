---
id: TASK-15
title: 'release:finalize prerelease-sweep follow-ups from #1598 review: (a) doc sync —…'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
labels:
  - 'area:tooling'
dependencies: []
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `release:finalize` prerelease-sweep follow-ups from #1598 review: (a) doc sync — finalize.ts module JSDoc, `/tzurot-git-workflow` SKILL.md step-6 description, and OPS_CLI_REFERENCE.md one-liner all still describe only the rebase sequence, none mention the sweep (SKILL.md is review-gated → needs a small PR); (b) per-tag failure attribution — a mid-loop `gh release edit` failure warns generically without naming which tag failed / how many succeeded (+ test). **Promote when**: next tooling/docs PR, or next release cut (whichever first).

**Why:** Skill/docs understating an automated step invites redundant manual work; attribution nit is diagnosability-only (self-heals next run).
<!-- SECTION:DESCRIPTION:END -->
