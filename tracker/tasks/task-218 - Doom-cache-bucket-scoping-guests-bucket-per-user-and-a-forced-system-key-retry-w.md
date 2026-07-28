---
id: TASK-218
title: 'Doom-cache bucket scoping: per-user guests + forced-system-key retry writes'
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'area:redis'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Doom-cache bucket scoping: guests bucket per-user, and a forced-system-key retry writes the USER's bucket

**Why:** Two related quirks of `deriveCacheKeyId(userApiKey, userId)` branching on key-definedness rather than billing entity (pre-existing, surfaced by the quota-fallback review). (a) Guests carry the resolved SYSTEM key, so `deriveCacheKeyId` returns `user:<id>` — each guest independently discovers a system-key outage instead of sharing the documented `system` bucket (efficiency loss, not correctness). (b) The quota fallback's forced-system-key retry (credit-exhausted BYOK) bills the system account but any CREDIT_EXHAUSTION it hits writes to the user's `user:<id>` bucket via LLMInvoker's failure caching — a coincident system-wide outage can prolong a block on a user whose own account already recovered (bounded by the wallet-update clear + 1h TTL). **Fix shape**: derive the bucket from the billing entity (e.g. source-aware `deriveCacheKeyId(source, userId)`), which fixes both at once; interacts with the key-rotation row above. **Promote when**: profiles Phase 1, or a user reports a stale block after a system outage. Surfaced 2026-07-06 (PR #1506 review).
<!-- SECTION:DESCRIPTION:END -->
