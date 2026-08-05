---
id: TASK-282
title: 'Export v2 leftovers: raw usage logs + avatar binaries on request'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 282000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Export v2 leftovers: raw usage logs + avatar binaries on request — The account export ships an aggregate usage summary and excludes avatar/voice binaries (disclosed in the README). If a user asks for raw per-request usage rows or their uploaded binaries, extend the assembler — the ZIP shape now makes both cheap to add as extra files. **Promote when**: a user asks. Surfaced 2026-07-15 (export v2 scope cut).

**Why:** Disclosed exclusions with zero demand yet; the ZIP layout keeps the door open.
<!-- SECTION:DESCRIPTION:END -->
