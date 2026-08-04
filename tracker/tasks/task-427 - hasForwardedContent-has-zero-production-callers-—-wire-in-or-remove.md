---
id: TASK-427
title: hasForwardedContent has zero production callers — wire in or remove
status: To Do
assignee: []
created_date: '2026-08-04 13:20'
updated_date: '2026-08-04 13:50'
labels:
  - 'size:S'
  - 'area:bot-client'
dependencies: []
priority: medium
ordinal: 427000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1948 round-2 review found (and grep confirms) that forwardedMessageUtils.hasForwardedContent is exported but called by nothing outside its own tests — EmptyMessageFilter short-circuits forwarded messages to never-empty before any content gate, and the extended-context path uses hasStickerOrPoll. The #1948 sticker-awareness fix to it is therefore inert: correct, tested, unreachable.

Fix shape: decide wire-or-remove. (a) If a real filtering path should consult it (e.g. a future forwarded-content gate), wire it there. (b) Otherwise delete the function and its tests — dead canonical-API surface invites a caller to assume it is live. Note knip did not flag it (test imports count as usage under current config), so this class is invisible to the dead-code gate.

Acceptance: the function has a production caller, or it no longer exists.
<!-- SECTION:DESCRIPTION:END -->
