---
id: TASK-80
title: Make cacheKeyId required in InvokeWithRetryOptions (option a)
status: To Do
assignee: []
created_date: '2026-04-29 00:00'
updated_date: '2026-09-04 19:55'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make `cacheKeyId` required in `InvokeWithRetryOptions` (option a)

**Why:** Option (b) — `logger.debug` opt-out log when `cacheKeyId.length === 0` — SHIPPED in PR #947, so the silent opt-out is now visible in local dev. PR #947 also added a consumer-side `assertValidCacheKeyId` call inside the else-branch as a separate guard (shape validation, not required-vs-optional). Option (a) — making the field required in the type so test fixtures must explicitly pass `''` — remains untouched. **Promote (a) when**: a 2nd production caller of `LLMInvoker.invokeWithRetry` is added (audit `services/ai-worker/src/services/` for new `invokeWithRetry` invocations). Originally surfaced 2026-04-29 PR #943; option (b) closed 2026-04-30 PR #947. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:55
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-18 (Theme Quota Billing Key Identity); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-80 finds it.
---
<!-- COMMENTS:END -->
