---
id: TASK-1513
title: BYOK rotation follow-ups from PR 2788 review round 5
status: To Do
assignee: []
created_date: '2026-11-23T02:02:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1513000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2788 (TASK-1356) review round 5 left four low items, deferred at the step-back point after four fix rounds.

1. packages/tooling/src/secrets/byok-consistency.ts (assertByokServicesConsistent, the CURRENT-differs refusal): in the stage-1 flow the lagging service own API_KEY_ENCRYPTION_KEY_NEXT already holds the target value, since NEXT is deleted only after both CURRENT writes. Say "set the lagging service API_KEY_ENCRYPTION_KEY to its own API_KEY_ENCRYPTION_KEY_NEXT" instead of pointing at dashboard history (still no value printed).
2. packages/common-types/src/utils/encryption.ts decryptApiKey comment claims each fallback key is resolved lazily, in order. Pin it with two tests: (a) a CURRENT-decryptable row still decrypts with a malformed NEXT set; (b) a row neither CURRENT nor PREVIOUS decrypts throws NEXT config error when NEXT is malformed. Or hedge the comment (02-code-standards: a comment that asserts behavior is a claim).
3. packages/tooling/src/secrets/byok-prepare-stage.ts stageByokWindow reads the gateway PREVIOUS twice (previous and snapshotPrevious); use previousByService[GATEWAY_SERVICE] so both see one value and one railway subprocess is saved.
4. The startup slot log: ai-worker logs byokPreviousKeySet/byokNextKeySet only when API_KEY_ENCRYPTION_KEY is configured, api-gateway unconditionally; align the condition or comment why.

Acceptance: each item fixed with a test where behaviour changes, or declined with the reason in the closing commit.
<!-- SECTION:DESCRIPTION:END -->
