---
id: TASK-525
title: >-
  Broaden RUNNER_STAGE_PATTERN if a service Dockerfile adopts a flag-bearing
  FROM
status: To Do
assignee: []
created_date: '2026-08-11 17:20'
updated_date: '2026-09-04 19:57'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 525000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: guard:dockerfile-dist anchors on /^\s*FROM\s+\S+\s+AS\s+runner\s*$/i, which requires a SINGLE token between FROM and AS. A multi-arch runner stage written as FROM --platform=$BUILDPLATFORM node:25-slim AS runner does not match, so classifyRunnerStage returns unnamed and the guard emits a runner-anchor finding on an otherwise-correct Dockerfile.

Surfaced by PR 2065 review round 6 as forward-looking Info. Not a defect today: no service Dockerfile uses the flag form (verified by grepping every FROM line), and the limitation is disclosed in the pattern JSDoc and pinned by a characterization test.

What: widen the pattern to tolerate leading flags on the image reference, keeping the end-of-line anchor that stops runner-debug from re-anchoring. Update the disclosed-limitation JSDoc and flip the characterization test from documenting the miss to asserting the match.

Promote when: any service Dockerfile gains a --platform flag on its runner stage, or CI reports a runner-anchor finding that traces to the flag form rather than to a genuine trailing stage. State observable rather than ready because the trigger arrives on its own — a red CI run naming the service.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:57
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-525 finds it.
---
<!-- COMMENTS:END -->
