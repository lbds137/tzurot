---
id: TASK-1147
title: 'command_events outcome=ok is a default, not evidence of success'
status: To Do
assignee: []
created_date: '2026-09-30 18:45'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1139000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the M3 joint-boot stall hunt (doc-109, 2026-09-30) misread three sessions for hours because commandDispatch.ts (emitCommandEvent path) only sets the outcome slot to non-ok on a THROWN error or the render choke point - any silent early return (channel-gate failure, NSFW check-failed, denylist mute) records outcome=ok with zero distinguishing signal. The TURNTACE instrumentation worker confirmed by read: commandDispatch.ts outcome slot semantics.



What: set the outcome slot at each early-return site (channel-unsupported, nsfw-not-verified, nsfw-check-failed, denylist block/mute) to a distinct outcome value (e.g. blocked_checkfailed, blocked_nsfw, blocked_channel, blocked_denylist), keeping ok for turns that actually reached delivery.



Acceptance: a synthetic /random into a gate-blocked condition records a non-ok outcome naming the gate; command_events consumers (retention sweeps, the digest) unaffected for genuinely-ok rows.
<!-- SECTION:DESCRIPTION:END -->
