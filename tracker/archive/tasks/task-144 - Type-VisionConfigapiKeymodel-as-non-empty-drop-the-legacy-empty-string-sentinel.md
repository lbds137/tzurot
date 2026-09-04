---
id: TASK-144
title: >-
  Type VisionConfig.apiKey/model as non-empty (drop the legacy empty-string
  sentinel)
status: To Do
assignee: []
created_date: '2026-06-14 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Type `VisionConfig.apiKey`/`model` as non-empty (drop the legacy empty-string sentinel)

**Why:** The no-`apiKeyResolver` legacy path in `ImageDescriptionJob` synthesizes `{ apiKey: '', model: '', ... }` and the call site normalizes the empties back to `undefined`. Works + documented, but `VisionConfig` permits `apiKey: ''` only in that one branch; typing `apiKey`/`model` as `string | undefined` (non-empty contract enforced at construction) would delete the normalization and stop a caller silently passing `''` to `createChatModel`. **Promote when**: `resolveVisionConfig`/`VisionConfig` gets a 3rd caller, OR the no-resolver legacy path is removed. Surfaced 2026-06-14 across #1204/#1208 reviews (test-fixture-only path; non-blocking).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the third resolveVisionConfig caller sees the empty-string sentinel in the diff.
---
<!-- COMMENTS:END -->
