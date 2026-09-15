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

A shared cause with the footer task (TASK-988) was proposed and then WEAKENED by an owner correction the same day. The proposal was that nothing on the record marks a fallback, so every reporter has to infer one from a model-name mismatch, which fails when the fallback lands on the same model id. The correction: the footer for that very request DID resolve the platform and said via OpenRouter. So the routing data plainly reaches at least one render path, and the absence of a marker cannot by itself explain a reporter that stayed silent. Treat the shared cause as OPEN, not likely.

That makes this task independent until proven otherwise, and it sharpens the first question: does the emitter fire and get filtered, or does it never fire? The footer and the log channel saw the same request and behaved differently, so whatever the emitter reads is not simply the same data the footer read.

Fix shape: find the emitter, determine whether the gap is a filter, a threshold, a fail-open catch, or a missed branch, and state which before changing anything - the answer decides whether this shares anything with TASK-988 at all.

Acceptance: the set of fallbacks that reach the log channel equals the set that occurred, over a window containing at least one same-model fallback; or, if some omissions turn out to be deliberate, the rule is written down and the remaining omissions match it.
<!-- SECTION:DESCRIPTION:END -->
