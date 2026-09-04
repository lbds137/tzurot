---
id: TASK-801
title: >-
  Add the ErrorChannelReporter in-memory caches to the durability-tiers
  inventory
status: To Do
assignee: []
created_date: '2026-08-28 22:56'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 801000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 03-database.md points at docs/reference/architecture/durability-tiers.md as the cache inventory, and none of ErrorChannelReporter three module-level TTLCaches appear in it: windowCache (1h dedup window), historyCache (2h, drives the Suppressed-since-last-report field), occurrenceCache (24h, added in PR #2245 for the Nth-occurrence counter). Raised in review of that PR. Two of the three predate it, so this is a pre-existing gap rather than a regression.

All three are Tier 1 by the doc own definition — recomputable for free, loss is correctness-neutral. The only consequence of losing them is a duplicate alert or a reset occurrence count, never wrong data.

Worth doing as a small pass rather than a three-row append: the same review noted the three share CACHE_MAX_SIZE=200 across very different TTLs, which is worth a line in the inventory, and the reason the gap existed at all is that nothing sweeps for unlisted in-memory caches. So the pass is: list these three, then grep for other module-level TTLCache and Map instances that are equally absent, and note in the inventory whether it is meant to be exhaustive or only cover caches with a durability question.

Also record the process-lifetime bound already written into the OCCURRENCE_TTL_MS comment: the counter resets on every bot-client deploy, so a #1 on a card is not proof the failure is novel.

Acceptance: the three caches appear in the inventory with their tier and TTL, and the doc states whether it aims to be exhaustive.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed still absent from the inventory doc; doc-only fix, cheap, and the review noted the underlying sweep gap (nothing catches unlisted module-level caches) is worth closing too. Evidence: `grep -n "ErrorChannelReporter\|windowCache\|historyCache\|occurrenceCache" docs/reference/architecture/durability-tiers.md` → no hits. Positive control: `grep -n "forwardedOriginCache" docs/reference/architecture/durability-tiers.md` → line 65, confirming the grep shape finds real entries when present.
---
<!-- COMMENTS:END -->
