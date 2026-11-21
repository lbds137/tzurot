---
id: TASK-1496
title: >-
  BYOK startup checks: local malformed _PREVIOUS logs ENABLED; no
  valid-_PREVIOUS deploy test
status: To Do
assignee: []
created_date: '2026-11-21T14:19:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1496000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2778 (TASK-1488) claude-review round 3 left two items, merged by owner choice (11-21).

1. services/api-gateway/src/bootstrap/startup.ts validateByokConfiguration: the deployed-only isEncryptionConfigured() check is skipped on a local run, so a malformed API_KEY_ENCRYPTION_KEY_PREVIOUS falls through to the info log that BYOK storage is ENABLED while every decrypt will throw (ai-worker warns in the same state). Fix: warn when not isEncryptionConfigured() on a local run.
2. services/ai-worker/src/startup.test.ts and services/api-gateway/src/bootstrap/startup.test.ts each hold a duplicate deployed-with-valid-key test pair. Repurpose one of each pair into the uncovered positive case: deployed, valid primary, VALID _PREVIOUS (the real rotation state) does not throw.

Acceptance: a gateway test pins the local warn; both services have the deployed valid-_PREVIOUS no-throw test; the duplicates are gone.
<!-- SECTION:DESCRIPTION:END -->
