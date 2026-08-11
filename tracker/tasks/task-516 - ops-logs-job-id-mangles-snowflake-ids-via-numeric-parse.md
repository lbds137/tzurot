---
id: TASK-516
title: ops logs --job-id mangles snowflake ids via numeric parse
status: To Do
assignee: []
created_date: '2026-08-11 00:23'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 516000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the 2026-08-11 deploy-window investigation, pnpm ops logs --env prod --job-id 1536529216659792013 silently grepped for 1536529216659792100 — the CLI parsed the id as a JS number and lost precision (snowflakes exceed 2^53). The query returned a false-empty across all three services, which reads as "no matching logs" (the exact lossy-step failure shape 10-working-posture warns about). Raw railway logs + local grep found the lines immediately.
What: treat --job-id and --request-id as STRINGS end to end in packages/tooling/src/ (find the cac/parse site that coerces numerics; cac auto-coerces numeric-looking args — likely needs a string cast or type option). Add a test with a >2^53 snowflake asserting the local-terms filter carries the exact literal.
Acceptance: the command echoes and greps the verbatim id; test pins it.
<!-- SECTION:DESCRIPTION:END -->
