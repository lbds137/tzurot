---
id: TASK-312
title: '/history has no browse/view: users run corrective/destructive commands (undo, clear,…'
status: To Do
assignee: []
created_date: '2026-07-21 00:00'
labels: []
dependencies: []
ordinal: 312000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-21 (walkthrough, Qwen 3.7 Max power-user finding) — `/history` has no `browse`/`view`: users run corrective/destructive commands (`undo`, `clear`, `purge`) without a way to inspect the stored rows first. **Fix shape**: `/history browse <character>` over the stored conversation rows (server-page mode of the shared browse builder). **Promote when**: a user reports deleting the wrong thing, or the next history-family feature touch.

**Why:** Additive feature, not a rename — nothing forces it into the breaking window.
<!-- SECTION:DESCRIPTION:END -->
