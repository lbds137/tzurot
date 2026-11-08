---
id: TASK-1091
title: >-
  Fold doc-108 rulings into tzurot-orchestration § Cloud dispatch, with the
  #2512 review residue
status: To Do
assignee: []
created_date: 2026-09-24 21:42
updated_date: '2026-11-08T19:37:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1084000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2512 folded the cloud dispatch mode into the skill and hit the review-round cap with six low items and two owner rulings still outside the skill. Process task, agent-generated.
Members: (1) lane routing by SHAPE and the two-slot count (doc-108, owner rulings 2026-09-24); (2) a pgvector version-gap clause in step 0 (VM 0.6.0 vs the CI image; medium: a cloud integration pass can mask a CI-only difference); (3) sha256sum pin on the Node tarball fetch; (4) a why-SUPERUSER comment or a narrower grant on the throwaway role; (5) the mode-table intro names the Cloud lane; (6) /tzurot-review-response § 3a gains the cloud-session resume case (round 7 finding); (7) a comment on the intentional double develop fetch.
Fix shape: one skills PR touching tzurot-orchestration and tzurot-review-response; run the two probes for (3) and (4) on a cloud unit before writing the lines (07-documentation.md § Command Blocks Are Code). Dispatch: resume the round-5 cloud session (ledger in docs/local/dispatch/cloud-sessions.md).
Acceptance: every member lands or is declined with a reason in the PR body; lines:check green.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-08 (Seyag B): seyag #257 merged 889328d, dispositions in lbds137/seyag#257 body. Members 1,2,3,5,6 shipped generically in Seyag (tier table, cloud cap rule, 'a cloud gate pass is not CI', sha256 pin, delegation § Cloud units resume). Tzurot-only, still ours: (4) SUPERUSER grant comment, (7) double develop fetch comment, plus the pgvector product specifics of (2). Unfreeze once Seyag A releases it and /reload-plugins; then this task shrinks to 4, 7 and pointers to the Seyag sections.
<!-- SECTION:NOTES:END -->
