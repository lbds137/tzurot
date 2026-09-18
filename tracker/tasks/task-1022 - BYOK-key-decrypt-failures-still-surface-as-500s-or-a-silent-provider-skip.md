---
id: TASK-1022
title: BYOK key decrypt failures still surface as 500s or a silent provider skip
status: To Do
assignee: []
created_date: '2026-09-18 23:44'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1018000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the TASK-958 class sweep (PR for fix/shapes-undecryptable-credential-401). TASK-958 fixed the shapes.inc session cookie so an undecryptable stored credential answers 401 re-authenticate instead of 500. The same defect SHAPE survives on a different credential, the BYOK provider keys, and was deliberately left out of that unit as a different credential family.

Three sites, each verified by the sweeping agent and each turning a decrypt failure into something the user cannot act on:
- services/api-gateway/src/routes/wallet/testKey.ts lines 67-68 returns internalError with Failed to decrypt stored API key, a 500.
- services/api-gateway/src/utils/elevenLabsKeyResolver.ts lines 60-61 does the same.
- services/api-gateway/src/utils/audioProviderKeyResolver.ts line 87 logs and silently skips the provider, so the caller sees a missing provider rather than an unreadable key.

Why it matters: a 500 reads as an outage and a silent skip reads as a misconfiguration, when the real state in both cases is that the stored key cannot be decrypted and the user needs to re-enter it. That is exactly the confusion TASK-958 was filed for, and the owner hit it once already on the shapes route.

Fix shape: mirror what TASK-958 did. Catch around ONLY the decrypt call at each site, return a 4xx naming the action the user must take for the two route paths, and for the resolver decide with the owner whether a silent skip is right or whether the caller should be told the key is unreadable. Do not widen any catch beyond the decrypt. One test per site built from a REAL specimen: encrypt with the real helper, corrupt the tag, and assert the thrown error is the GCM auth-tag failure rather than a missing-key config error, or the test passes for the wrong reason.

Acceptance: no BYOK decrypt failure reaches the caller as a 500 or as a silent absence; each site has a test pinning the user-visible answer; the tests fail when the catch is removed.
<!-- SECTION:DESCRIPTION:END -->
