---
id: TASK-471
title: Make the release-cut trigger risk-weighted instead of counting all PRs equally
status: Done
assignee: []
created_date: '2026-08-08 19:11'
updated_date: '2026-08-08 19:37'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 471000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Council suggestion (Kimi K3, 2026-08-08) during the beta.196 sequencing pass. Not acted on unilaterally because it edits an always-loaded rule.

Problem: 10-working-posture "Ship in bounded units" counts substantive PRs and treats them as interchangeable. The trigger fired on a range containing ZERO files under services/ and ZERO under prisma/ - entirely developer tooling, git hooks, CI config and backlog docs. The rule exists so the holistic release review is not diluted, and that review earns its keep on RUNTIME risk headed for prod. A tooling-only batch dilutes nothing, so the counter demanded a release the risk model did not.

Second defect found in the same pass: the rule says PRs but the natural thing to count is commits, and under rebase-only merging those differ a lot. Measured on this range: 15 substantive commits versus 9 merged PRs. Counting the wrong unit inflated the trigger by two thirds and produced a wrong recommendation that a council had to overturn.

Fix shape: weight the count by what the PRs touch - services/, prisma/, .github/workflows/, package.json - and let tooling-only or docs-only batches cut at convenience or at roughly twice the threshold. Say explicitly that the unit is merged PRs, and name a command that counts them so the next reader does not re-derive it from commits.

Acceptance: the trigger in 10-working-posture names its unit unambiguously and distinguishes runtime-bearing from tooling-only batches. Rules are review-gated, so this goes through a PR, and it must not grow the always-loaded budget much - the whole point is economy.
<!-- SECTION:DESCRIPTION:END -->
