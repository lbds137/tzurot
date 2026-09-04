---
id: TASK-709
title: 'Forwarded-origin priming has no in-flight dedup, only a completed-result cache'
status: To Do
assignee: []
created_date: '2026-08-21 00:01'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 709000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised in all three claude-review rounds on PR 2166 and dismissed on merit each time. Filed so it stops being re-litigated per round and has a home if the trigger ever fires.

Mechanism: primeForwardedOrigins checks positive().has(id) or negative().has(id) BEFORE awaiting resolveForwardedOrigin and sets the entry AFTER. Two extended-context fetches that race on the same not-yet-cached forward therefore both pass the check and both pay the Discord REST round-trip pair. Correctness is unaffected: the resolution is deterministic, so both writes agree and last-write-wins is fine.

Why it is not being fixed now: the fix is an in-flight Map of message id to Promise, which brings its own lifecycle - rejection handling, eviction on settle, and a leak if a promise never settles. That is more machinery than the one duplicate fetch pair it removes, in a case that needs two concurrent context builds touching the same forward on its first touch.

Related scope note from the same review, recorded so it is not rediscovered: MAX_FORWARD_ORIGIN_RESOLUTIONS_PER_FETCH bounds ONE fetch, not the process. Concurrent fetches multiply it. The constant name says PER_FETCH and the docstring is accurate, so nothing is wrong - but a global ceiling, if ever wanted, is a different mechanism (a shared limiter) and not a change to this constant.

Promote when: Discord REST pressure or rate-limit warnings appear that trace to forward-origin resolution.

Acceptance: either an in-flight dedup lands with the promise lifecycle handled, or the item is closed with a measurement showing duplicate resolutions are not a meaningful share of REST volume.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-709 finds it.
---
<!-- COMMENTS:END -->
