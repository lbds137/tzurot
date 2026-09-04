---
id: TASK-282
title: 'Export v2 leftovers: raw usage logs + avatar binaries on request'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-09-04 19:36'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. watch with a named trigger ("a user asks"); the disclosed exclusion and ZIP shape that makes it cheap are both still true and unchanged. Weak keep — if it vanished, nothing breaks and nobody would notice until someone actually asks. Evidence: `git grep -n avatar services/ai-worker/src/jobs/AccountExportAssembler.ts` → `omit: { avatarData: true, voiceReferenceData: true }` (line 270) and the disclosure string at line 107 are both present, unchanged.
---
<!-- COMMENTS:END -->
