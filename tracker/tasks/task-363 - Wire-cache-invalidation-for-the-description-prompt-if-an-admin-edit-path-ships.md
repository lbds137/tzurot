---
id: TASK-363
title: Wire cache invalidation for the description prompt if an admin edit path ships
status: To Do
assignee: []
created_date: '2026-07-30 19:11'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:S'
  - 'area:ai-worker'
dependencies: []
priority: low
ordinal: 363000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `DescriptionPromptService` (ai-worker) polls the `isDefault`
`system_prompts` row on a TTL with no pub/sub invalidation, unlike the services
in `03-database.md`'s cache table that ARE wired (`CacheInvalidationService`,
`LlmConfigCacheInvalidationService`, etc.). That is correct today — nothing in
the product mutates that row's CONTENT at runtime, so a short poll is
sufficient and the wiring would be dead weight.

It stops being correct the moment an admin surface can edit the default system
prompt: until the TTL lapses, ai-worker would keep framing image descriptions
with the OLD prompt, and every description written in that window is cached and
reused by other personalities. Surfaced 2026-07-30 by #1873 round-4 review,
which confirmed the omission is currently intentional rather than a gap.

**Fix shape**: subscribe the service to the same Redis pub/sub channel pattern
the other invalidation services use, publishing on the admin write path;
`refresh()` is already public and single-flighted, so the subscriber is a
one-liner.

**Promote when**: any write path that mutates a `system_prompts` row's content
ships — an admin UI, an ops command, or a seed/bootstrap that updates rather
than creates.
<!-- SECTION:DESCRIPTION:END -->
