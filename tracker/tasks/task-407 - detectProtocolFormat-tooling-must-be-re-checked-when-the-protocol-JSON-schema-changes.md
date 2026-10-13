---
id: TASK-407
title: >-
  Add a cross-reference comment at parseProtocolJson pointing to its tooling
  mirror detectProtocolFormat
status: To Do
assignee: []
created_date: '2026-08-03 01:07'
updated_date: '2026-10-13 01:30'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 407000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/prompt/voice-probes.ts detectProtocolFormat deliberately duplicates ai-worker PersonalityFieldsFormatter.parseProtocolJson validation (tooling cannot import ai-worker internals). If production ever changes the protocol shape (new required field, looser validation), the miner will silently misclassify protocol formats.
Fix shape: when touching parseProtocolJson, update detectProtocolFormat in the same PR; the pinning test in voice-probes.test.ts (matches production fallback semantics) documents the contract but cannot see cross-package drift.
Surfaced by PR 1910 review.

Re-scoped 2026-10-12 (Batch B review): a tracker row cannot fire when parseProtocolJson changes, so the durable fix is a cross-reference comment at the producer (PersonalityFieldsFormatter.parseProtocolJson) naming detectProtocolFormat in packages/tooling/src/prompt/voice-probes.ts as the mirror to update. git grep found no such comment in services/ai-worker/src. Close this task when that comment lands (code change, so it rides the next ai-worker PR).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Standing structural risk (deliberate duplication across a package boundary tooling can't import across) rather than a fired trigger — `parseProtocolJson`'s producer file hasn't changed since filing, so there's nothing to re-sync yet, but the guard-shaped reminder is still needed for the next time it does. Evidence: `git log --oneline --since=2026-08-03 -- services/ai-worker/src/services/prompt/PersonalityFieldsFormatter.ts` → no commits touching that file since filing.
---
<!-- COMMENTS:END -->
