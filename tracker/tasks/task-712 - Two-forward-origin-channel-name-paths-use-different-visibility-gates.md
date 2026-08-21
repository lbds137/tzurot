---
id: TASK-712
title: Two forward-origin channel-name paths use different visibility gates
status: To Do
assignee: []
created_date: '2026-08-21 01:47'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: high
ordinal: 712000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2167 review round 4. That PR added a fail-closed CHANNEL-visibility gate for the forwarded-quote channel name on the history and extended-context path: permissionsFor(forwarderId) must carry ViewChannel, plus a private-thread membership lookup, and anything unverifiable yields no name.

A second path renders the same data with a materially weaker gate, untouched by that PR. SnapshotFormatter.buildForwardMarker (services/bot-client/src/handlers/references/SnapshotFormatter.ts:34-49) emits (forwarded from #name) into the snapshot locationContext, gated ONLY on whether the BOT has the origin channel in its client cache. There is no per-forwarder check of any kind. Its docstring states the reasoning plainly - a name is meaningful exactly when the bot is a member, which is also when the channel is cached - which is a claim about the BOT seeing the channel, not about the person who forwarded it.

So the same fact reaches the model through two paths with opposite postures. Reached via ReferencedMessageFormatter.fromLiveReference on the reply-to-a-forward and link-to-a-forward paths, and that locationContext string is PERSISTED into messageMetadata.referencedMessages, so it outlives the turn.

Pre-existing, not a regression from 2167 - which is why it was filed rather than folded in. It is also a security-posture question rather than a nit, so the disposition is the owner call, not the agent one.

Decide between: (a) port the 2167 gate so both paths agree on fail-closed, (b) decide the bot-cache gate is sufficient here and record WHY the two paths may legitimately differ, or (c) route both through one helper once TASK-710 extracts the private-thread check. Note (b) needs a real argument - the two paths carry the same data to the same consumer.

Acceptance: the two paths either share a gate or carry a recorded reason for differing; whichever way, the reason lives next to buildForwardMarker so the next reader does not have to rediscover the divergence.
<!-- SECTION:DESCRIPTION:END -->
