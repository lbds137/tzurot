---
id: TASK-989
title: Fallback events reach the Discord log channel only some of the time
status: To Do
assignee: []
created_date: '2026-09-15 01:59'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 985000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-15. During Chinese working hours the z.ai coding plan sheds load and calls fall back to OpenRouter. Some of those fallbacks appear in the owner log channel on Discord and some do not - the reporting is partial. Whether the omission is deliberate filtering or a gap is unknown; the owner is not sure either.

The specific observed miss came with a debug payload (debug-1853210a, the GLM 5.2 z.ai to OpenRouter fallback) that reached no log line at all.

Likely shared cause with the footer task: a grep for fallbackFrom, didFallback, wasFallback, fallbackUsed and routedVia finds no explicit fallback marker on the record, so anything that reports fallbacks is inferring them rather than being told. An inference that works for a cross-model fallback fails for a same-model one. That is a hypothesis and the first thing to check.

Fix shape: find the emitter, determine whether the gap is a filter, a threshold, a fail-open catch, or a missed branch, and state which before changing anything. If the marker field from the sibling task lands first, this likely becomes a consumer of it.

Acceptance: the set of fallbacks that reach the log channel equals the set that occurred, over a window containing at least one same-model fallback; or, if some omissions turn out to be deliberate, the rule is written down and the remaining omissions match it.
<!-- SECTION:DESCRIPTION:END -->
