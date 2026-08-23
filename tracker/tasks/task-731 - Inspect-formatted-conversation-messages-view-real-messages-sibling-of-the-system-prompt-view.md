---
id: TASK-731
title: >-
  Inspect: formatted conversation-messages view (real-messages sibling of the
  system-prompt view)
status: Done
assignee: []
created_date: '2026-08-22 14:12'
updated_date: '2026-08-23 00:26'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 731000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner request (2026-08-22). Flag-on, history rides as real user/assistant messages, so the interesting prompt content moves out of the system prompt and into the messages array — which /inspect today only offers as raw JSON. The owner wants a clean per-message view, the same treatment the system prompt XML got. Most valuable at/before the PR 2.5 staged rollout, since runtime inspection is the owner primary verification layer for the flip.
What: a new DebugViewType + view builder in services/bot-client/src/commands/inspect/ following the established per-view pattern — buildSystemPromptView (views.ts:175) extracts the system message; this one renders every NON-system message in ship order as readable blocks (role, then content verbatim — headers, gap lines, cross-channel XML as-is), plus a select/button entry and custom id routing. Works flag-off too (shows the current message), so no flag coupling.
Acceptance: inspect offers the view; each message renders as its own labeled block in ship order; snapshot/component tests per the inspect view convention.

**Owner decision (2026-08-22)**: build alongside the 9d units (TASK-726/727/728/729), BEFORE the PR 2.5 flip — it is the owner runtime-verification surface for the staged rollout.
<!-- SECTION:DESCRIPTION:END -->
