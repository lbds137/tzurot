---
id: TASK-1509
title: Update stale EncryptionMisconfiguredError JSDoc in ApiKeyResolver
status: To Do
assignee: []
created_date: '2026-11-22T13:40:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1509000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.248 release review (PR #2786) flagged that EncryptionMisconfiguredError JSDoc at services/ai-worker/src/services/ApiKeyResolver.ts:92-94 still says a fully unset API_KEY_ENCRYPTION_KEY skips user lookup and serves guest mode (referencing TASK-1488), which is the opposite of post-#2778 behavior (TASK-1488 is Done; resolveApiKey/tryResolveUserKey always run the lookup and deployed services fail fast at startup).

What: Update the JSDoc block on EncryptionMisconfiguredError in services/ai-worker/src/services/ApiKeyResolver.ts:85-97 to match current post-#2778 behavior and drop the stale TASK-1488 reference.

Acceptance: EncryptionMisconfiguredError JSDoc accurately describes unset/malformed key handling and startup fail-fast on deployed environments.
<!-- SECTION:DESCRIPTION:END -->
