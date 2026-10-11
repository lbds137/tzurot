---
id: TASK-1206
title: >-
  PR-body claim scan has no preflight: drafts are tuned by trial and error
  against the hook
status: To Do
assignee: []
created_date: '2026-10-11 11:07'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pr-body-ref-gate rule 2 (claim-shaped line with no cite or hedge) blocks once per body text per day, and the only way to see its verdict is to attempt the gh pr create/edit. Session mining (2026-10-11) counted 17 trips in 5 sessions with zero false positives, but one session took 8 attempts to land a body. The gate is right; the missing piece is running its detector on the body FILE while drafting.

What: expose the existing scan as a read-only check over a file (a --check <file> mode on the hook, or a pnpm ops command sourcing the same claim-shapes lib) that prints every flagged line with the rule that flagged it, and add the call to /tzurot-git-workflow § Create PR before gh pr create. One scanner, two callers; no second vocabulary copy.

Acceptance: the preflight flags exactly the lines the hook would block on (a probe row runs both over the same fixture); the git-workflow step names it.

Seyag note: claim-shape scanning is not Tzurot-specific (seyag ships claim-shape-guard for code comments). If the preflight lands generic, offer it upstream via Deck.
<!-- SECTION:DESCRIPTION:END -->
