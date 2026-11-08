---
id: TASK-1359
title: ai-worker silently demotes a user with an undecryptable BYOK key to guest mode
status: To Do
assignee: []
created_date: '2026-11-08T05:47:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:owner
dependencies: []
priority: medium
ordinal: 1342000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found at the TASK-1022 PR read by enumerating every production decryptApiKey call site (git grep decryptApiKey( outside tests and encryption.ts: six sites). TASK-1022's sweep listed three api-gateway sites and missed services/ai-worker/src/services/ApiKeyResolver.ts getUserApiKey (grep token: Failed to retrieve/decrypt user API key). Its try wraps both the Prisma read and decryptApiKey and returns null on ANY throw; resolveApiKey then falls back to the system key with isGuestMode true (free models only) and caches that result. So a user whose stored key will not decrypt gets free-tier replies with no signal that their key is unreadable, and a service-level encryption misconfiguration demotes every BYOK user the same way instead of failing loudly. No spend leak (guest mode is free models only).

What: mirror the TASK-1022 shape: narrow the catch to the decrypt call, rethrow when isEncryptionConfigured() is false, and decide how the user learns the key is unreadable (a job error carrying undecryptableApiKeyMessage from common-types utils/providerDisplayName, or keep guest fallback plus a notice). Do not cache a decrypt-failure guest result.

Owner question: when a user's saved key cannot be decrypted, should their message fail with the re-enter-your-key copy, or keep answering on free models with a notice?
Recommendation: fail with the re-enter copy — silent downgrade is the same confusion TASK-958 and TASK-1022 fixed, and the user can act on it.

Acceptance: real-specimen test (corrupted GCM tag) pins the chosen user-visible answer; a misconfiguration test (env vars deleted) pins the rethrow; neither caches a guest result.
<!-- SECTION:DESCRIPTION:END -->
