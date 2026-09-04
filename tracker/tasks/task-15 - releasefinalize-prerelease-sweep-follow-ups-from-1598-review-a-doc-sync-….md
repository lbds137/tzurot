---
id: TASK-15
title: 'release:finalize prerelease-sweep follow-ups (doc sync)'
status: To Do
assignee: []
created_date: '2026-07-12 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-12 — `release:finalize` prerelease-sweep follow-ups from #1598 review: (a) doc sync — finalize.ts module JSDoc, `/tzurot-git-workflow` SKILL.md step-6 description, and OPS_CLI_REFERENCE.md one-liner all still describe only the rebase sequence, none mention the sweep (SKILL.md is review-gated → needs a small PR); (b) per-tag failure attribution — a mid-loop `gh release edit` failure warns generically without naming which tag failed / how many succeeded (+ test). **Promote when**: next tooling/docs PR, or next release cut (whichever first).

**Why:** Skill/docs understating an automated step invites redundant manual work; attribution nit is diagnosability-only (self-heals next run).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The doc-sync gap is still live — finalize.ts's own JSDoc and the OPS_CLI_REFERENCE row both still describe only the rebase step, not the prerelease sweep. Evidence: `sed -n '1,10p' packages/tooling/src/release/finalize.ts` → JSDoc mentions only step 6/rebase; `grep -n -A2 "release:finalize" docs/reference/tooling/OPS_CLI_REFERENCE.md` → same, no sweep mention.
---
<!-- COMMENTS:END -->
