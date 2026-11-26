---
id: TASK-1555
title: >-
  Model cache key isolates API keys by a 10-char prefix that OpenRouter keys
  share
status: Done
assignee: []
created_date: '2026-11-25T20:52:00Z'
updated_date: '2026-11-26T13:51:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1550000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/ai-worker/src/services/modelFactory/CacheKeyBuilder.ts:46-48 isolates cached ChatOpenAI clients by apiKey.substring(0, 10). Every OpenRouter key starts with the 9-char vendor prefix (probed on the dev key 11-25: prefix match true, length 73), so the prefix carries one hex char: 16 buckets for all OpenRouter keys. LLMInvoker.getModel (services/ai-worker/src/services/LLMInvoker.ts:186-192) returns the cached client, whose apiKey is baked in, for any config with the same cache key. Two BYOK users, or a BYOK user and the system key, with the same model and params and a colliding hex char can be served by each other client: spend billed to the wrong key, and BYOK traffic leaving under the system key. Configs carrying a sessionId (prompt-caching gate) are partly shielded. Code-reading plus the key-shape probe; not runtime-reproduced.

What: isolate on a non-reversible digest of the whole key (e.g. sha256 truncated to 16 hex chars), never a raw substring, so no key material enters the cache key.

Acceptance: a CacheKeyBuilder test with two fixture keys sharing their first 10 chars yields different keys (fixture keys not vendor-shaped); a canary reverting to the substring goes red; the digest helper has its own test.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PR #2818 (fix/task-1555-cache-key-whole-key-digest @ 2e66e4753).
<!-- SECTION:NOTES:END -->
