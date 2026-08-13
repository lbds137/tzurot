---
id: TASK-535
title: participantUtils logs raw persona display names
status: Done
assignee: []
created_date: '2026-08-11 21:58'
updated_date: '2026-08-13 23:01'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 535000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: reviewer finding on PR 2067. That PR stripped personaName from every log call in MemoryRetriever, on the reasoning that a personaName is sometimes the raw Discord display name AND - the stronger argument - that a name does not identify anyone, since two different users can share one. participantUtils.ts around line 185 does logger.debug with a participantNames field holding a joined string of those same display names, and was outside that diff.

Same class, same reasoning, different file. Filed rather than swept into 2067 because that PR was a map-keying fix and had already widened once to cover its own function.

What: drop participantNames from the log and keep the count plus persona ids, matching how MemoryRetriever now logs. Check the surrounding lines for the same shape while there - the sweep in 2067 found five sites in one function when the reviewer had flagged three.

Acceptance: no raw persona or display name reaches a log line in participantUtils; ids and counts remain.
<!-- SECTION:DESCRIPTION:END -->
