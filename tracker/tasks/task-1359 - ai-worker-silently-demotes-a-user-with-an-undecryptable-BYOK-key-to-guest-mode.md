---
id: TASK-1359
title: ai-worker silently demotes a user with an undecryptable BYOK key to guest mode
status: Done
assignee: []
created_date: '2026-11-08T05:47:00Z'
updated_date: '2026-11-21T03:11:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 60
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found at the TASK-1022 PR read by enumerating every production decryptApiKey call site (git grep decryptApiKey( outside tests and encryption.ts: six sites). TASK-1022's sweep listed three api-gateway sites and missed services/ai-worker/src/services/ApiKeyResolver.ts getUserApiKey (grep token: Failed to retrieve/decrypt user API key). Its try wraps both the Prisma read and decryptApiKey and returns null on ANY throw; resolveApiKey then falls back to the system key with isGuestMode true (free models only) and caches that result. So a user whose stored key will not decrypt gets free-tier replies with no signal that their key is unreadable, and a service-level encryption misconfiguration demotes every BYOK user the same way instead of failing loudly. No spend leak (guest mode is free models only).

What: mirror the TASK-1022 shape: narrow the catch to the decrypt call, rethrow when isEncryptionConfigured() is false, and decide how the user learns the key is unreadable (a job error carrying undecryptableApiKeyMessage from common-types utils/providerDisplayName, or keep guest fallback plus a notice). Do not cache a decrypt-failure guest result.

Owner question: when a user's saved key cannot be decrypted, should their message fail with the re-enter-your-key copy, or keep answering on free models with a notice?
Recommendation: fail with the re-enter copy — silent downgrade is the same confusion TASK-958 and TASK-1022 fixed, and the user can act on it.

Acceptance: real-specimen test (corrupted GCM tag) pins the chosen user-visible answer; a misconfiguration test (env vars deleted) pins the rethrow; neither caches a guest result.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
11-19 pass: Medium -> High (user-visible silent downgrade). Awaiting the owner decision in the Owner question line.

Owner ruling 2026-11-20 (AskUserQuestion): fail with the re-enter-your-key copy (no silent free-model downgrade).

Owner ruling 2026-11-20 (AskUserQuestion): the re-enter-your-key copy renders PLAINLY in Discord, not inside the error spoiler, in the TASK-1359 PR (new errorInfo.userActionMessage; spec .claude/dispatch/credit-1359-r1.md).

Owner ruling 2026-11-20 (AskUserQuestion, PR #2776 review round 1): the hard failure applies only to the key the reply is routed on (explicit z.ai preset, main provider key). Secondary probes (z.ai auto-promotion, the vision-provider key) treat an undecryptable row as absent and log a warning, so the reply runs on the user's own working key; never a silent drop to free models for the text reply.
<!-- SECTION:NOTES:END -->
