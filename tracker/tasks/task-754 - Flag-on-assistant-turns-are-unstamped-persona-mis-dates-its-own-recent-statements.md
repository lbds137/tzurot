---
id: TASK-754
title: >-
  Flag-on: assistant turns are unstamped - persona mis-dates its own recent
  statements
status: Done
assignee: []
created_date: '2026-08-23 21:05'
updated_date: '2026-08-24 00:42'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 754000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-23 (Lila Elyona, glm-5.3, channel 925094911961882704, requestId 9cf34e1b) - the persona said "yesterday" about its own statement from ~17 minutes earlier, and the same payload response contrasts "Yesterday: one specimen, binary verdict. Today: comparative anatomy" with the referent event actually same-day. This is the TASK-745 WATCH item (flag-on temporal confusion) observed in prod, with the mechanism now payload-verified.
Mechanism (payload 9cf34e1b, 92 messages): USER-role history carries [Name - 2026-08-23 (Sun) 15:18] headers and [time gap: Nh Nm] markers, quoted messages even carry relative annotations (t=...16:18 - 15 minutes ago) - but the persona OWN prior turns (assistant role) render as bare undated content. To date its own past statements the model must infer from neighboring user headers across a 92-message span containing a 21h25m gap; it mapped a 16:22 same-day event to "yesterday".
Fix shape (design at build): give assistant turns a temporal marker the model can read without learning to emit it - candidates: (a) same [Name - date time] header on assistant turns (echo-artifact stripping already ships for headers), (b) a compact leading annotation only when the turn is >N hours old, (c) fold assistant timestamps into the existing time-gap marker text. Constraint: whatever renders must stay inside the echo-strip coverage so the persona does not start emitting headers itself.
Acceptance: assistant-role history turns carry a model-readable timestamp (or age) signal; a render test pins it; echo-artifact stripping covers the chosen shape; owner-observed misdating stops recurring in prod.
<!-- SECTION:DESCRIPTION:END -->
