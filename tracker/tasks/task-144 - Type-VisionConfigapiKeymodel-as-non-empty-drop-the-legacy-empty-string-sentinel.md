---
id: TASK-144
title: 'Type VisionConfig.apiKey/model as non-empty (drop the legacy empty-string sentinel)'
status: To Do
assignee: []
created_date: '2026-06-14 00:00'
labels: []
dependencies: []
ordinal: 144000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Type `VisionConfig.apiKey`/`model` as non-empty (drop the legacy empty-string sentinel)

**Why:** The no-`apiKeyResolver` legacy path in `ImageDescriptionJob` synthesizes `{ apiKey: '', model: '', ... }` and the call site normalizes the empties back to `undefined`. Works + documented, but `VisionConfig` permits `apiKey: ''` only in that one branch; typing `apiKey`/`model` as `string | undefined` (non-empty contract enforced at construction) would delete the normalization and stop a caller silently passing `''` to `createChatModel`. **Promote when**: `resolveVisionConfig`/`VisionConfig` gets a 3rd caller, OR the no-resolver legacy path is removed. Surfaced 2026-06-14 across #1204/#1208 reviews (test-fixture-only path; non-blocking).
<!-- SECTION:DESCRIPTION:END -->
