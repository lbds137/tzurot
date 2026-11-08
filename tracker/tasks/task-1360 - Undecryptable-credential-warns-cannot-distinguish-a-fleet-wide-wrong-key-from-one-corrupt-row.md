---
id: TASK-1360
title: >-
  Undecryptable-credential warns cannot distinguish a fleet-wide wrong key from
  one corrupt row
status: To Do
assignee: []
created_date: '2026-11-08T07:32:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1343000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR 2721 (TASK-1022). The three undecryptable-credential sites (api-gateway routes/wallet/testKey.ts, utils/elevenLabsKeyResolver.ts, routes/user/shapes/list.ts) rethrow only when isEncryptionConfigured() reports false (packages/common-types/src/utils/encryption.ts, grep isEncryptionConfigured), which detects a missing or malformed key but not a WRONG one. If rows are encrypted under a key that is neither current nor previous (a BYOK rotation finalized with secrets:rotate-byok --stage 3 before re-encryption covered every row, or a wrong key value set on an environment), every affected user gets the re-enter 401 and the only trace is one per-user logger.warn per request. A fleet-wide key incident then reads as routine per-user noise. Not a regression: TASK-958 made the same trade-off on shapes, and TASK-1022 copied it.

What: give operators a signal that separates the two cases, e.g. a counter or rate check over these warns that escalates (error log or owner-channel alert) past a threshold, or a startup self-check that decrypts one known row per family. Decide the mechanism in the PR; keep the per-user 401 copy unchanged.

Acceptance: a test drives N undecryptable failures past the threshold and asserts the escalation fires once; a single failure does not escalate.
<!-- SECTION:DESCRIPTION:END -->
