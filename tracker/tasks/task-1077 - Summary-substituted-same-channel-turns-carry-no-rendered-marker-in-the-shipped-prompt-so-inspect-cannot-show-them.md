---
id: TASK-1077
title: >-
  Summary-substituted same-channel turns carry no rendered marker in the shipped
  prompt, so /inspect cannot show them
status: To Do
assignee: []
created_date: '2026-09-24 12:45'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1070000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the comment above renderedAttr in services/ai-worker/src/jobs/utils/conversationUtils.ts (grep 'rendered="summary"') says the attribute surfaces a same-channel summary substitution so /inspect shows which turns were reduced. Runtime (dev, 2026-09-24, TASK-1039 read): the ai-worker log for one Lilith turn reported mode summarized, summarized 4, and the matching llm_diagnostic_logs row (05:15:32Z, channel 1552294416188833822) carries those 4 stored summaries in assembledPrompt (checked by prefix match, booleans only) but zero rendered= occurrences. So the marker never reached the stored prompt on that turn. Cause not verified: a candidate is that this prompt went through a renderer that does not emit the attribute (the ContextStep docstring names two chat-log renderers, XML and real-message), or that renderedAs is dropped by a mapping step between the render and the formatter.
Fix shape: trace renderedAs from sameChannelRender.ts to every chat-log renderer, carry it through whichever drops it, and pin it with a test that runs the real render chain into the formatter for each renderer mode.
Acceptance: a summarized turn shows its marker in the stored diagnostic prompt under every renderer mode, and the conversationUtils comment is true.
<!-- SECTION:DESCRIPTION:END -->
