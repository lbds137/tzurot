---
id: TASK-487
title: Blocking questions must surface via formal tooling - remote control gap
status: To Do
assignee: []
created_date: '2026-08-09 16:08'
labels:
  - 'area:process'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 487000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask 2026-08-09 (verbatim): sometimes Claude Code asks about something but does not use the formal question tooling, so something silently waits on input with no phone notification - remote control only surfaces actual tool decision points (plan review, AskUserQuestion).
Fix shape, two layers: (1) rule line in 09-interaction-style.md - a turn that ends blocked on user input MUST go through AskUserQuestion (structured choices) or send a PushNotification (open-ended asks that do not fit the option format); prose-only questions are invisible to the phone. (2) Stop-hook (deterministic backstop): on turn end, if the final assistant text ends in a question shape and neither AskUserQuestion nor PushNotification was used this turn, block once with an instruction to route the ask through the formal channel (ack-file pattern like pr-merge-review-check). Needs a probe per guard:hook-probes.
Acceptance: rule + hook + probe shipped via review-gated PR; a prose-question turn end gets caught by the hook in a live session.
<!-- SECTION:DESCRIPTION:END -->
