---
id: TASK-1488
title: >-
  ai-worker silently demotes every BYOK user to guest when
  API_KEY_ENCRYPTION_KEY is unset
status: To Do
assignee: []
created_date: '2026-11-21T02:38:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1488000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ApiKeyResolver builds this.encryptionKey from config.API_KEY_ENCRYPTION_KEY ?? empty (services/ai-worker/src/services/ApiKeyResolver.ts:128). When it is empty, resolveApiKey skips the user lookup (:170) and returns a cached guest result, and tryResolveUserKey returns null (:266), with only a startup warn (:134). A deploy that loses the variable drops every BYOK user to free models silently: the same class as TASK-1359 and TASK-1486. TASK-1359 (PR #2776) only made a MALFORMED or env-disagreeing key loud.

What: fail fast at ai-worker startup when API_KEY_ENCRYPTION_KEY is unset or malformed in a deployed environment (00-critical: validate required env vars at startup with fail-fast), or make the resolver throw EncryptionMisconfiguredError instead of skipping the user lookup. Check whether any environment legitimately runs ai-worker without BYOK before choosing.

Acceptance: a test with an empty key and an existing BYOK row pins the chosen loud behaviour; no guest result is cached in that state.
<!-- SECTION:DESCRIPTION:END -->
