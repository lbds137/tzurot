---
id: TASK-577
title: >-
  Tag command paths skip the autocomplete-error-sentinel guard; take:500 doc
  claim imprecise + admin vocabulary clipping
status: To Do
assignee: []
created_date: '2026-08-12 22:39'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 577000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: (1) ~20 commands guard autocompleted values with isAutocompleteErrorSentinel at submit; the new tag consumers (chime-in execute, randomPick, chimeInTag) and the pre-existing character: path do not - submitting the error choice yields a confusing "No characters carry the tag __autocomplete_error__" reply. Consistency nit, not a regression. (2) tagPool.ts:11-13 says the list is "capped at take: 500" but actual gateway bounds are 500 public + 100 owned-private for users, while the ADMIN gets a single take:500 over ALL personalities ordered by name - past 500 rows the admin’s own characters can vanish from the admin’s tag vocabulary/fan-out pool while staying visible to their owners. Doc fix now; the clipping gets real only at scale.

Source: 2026-08-12 review, tags F5/F7 CONFIRMED.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed — `chimeInTag.ts` and `randomPick.ts` are absent from every file that calls `isAutocompleteErrorSentinel`; submitting the autocomplete error choice still yields the confusing generic message. Evidence: `grep -rln "isAutocompleteErrorSentinel" services/bot-client/src --include=*.ts | grep -v test` → 23 files, none named `chimeInTag.ts`, `randomPick.ts`, or `chimeIn` execute.
---
<!-- COMMENTS:END -->
