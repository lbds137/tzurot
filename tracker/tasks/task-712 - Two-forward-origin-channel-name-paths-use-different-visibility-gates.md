---
id: TASK-712
title: Two forward-origin channel-name paths use different visibility gates
status: To Do
assignee: []
created_date: '2026-08-21 01:47'
updated_date: '2026-08-21 03:17'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
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

OWNER DECISION 2026-08-21: INCLUDED in beta.206, resolving to option (a) — port the gate so both paths agree on fail-closed. Options (b) record-why-they-differ and (c) wait-for-TASK-710 are closed; do not re-open them.

What that means concretely, so the next session does not re-derive it: buildForwardMarker gains the same forwarder-scoped check resolveOriginChannelName has — permissionsFor(forwarder) must carry ViewChannel, plus the private-thread membership lookup — and falls back to the existing generic (forwarded message) marker when it does not, exactly as it already does for an uncached channel. The fallback path is already there, so this changes which inputs reach it, not what it renders.

Two things to settle at build time rather than now:
- buildForwardMarker is SYNCHRONOUS and the private-thread check is async. Either make it async and thread that through ReferencedMessageFormatter.fromLiveReference, or gate only on the synchronous ViewChannel half here and accept that private threads stay bot-cache-gated on this path. Prefer the former; if the call chain makes it ugly, the latter is still strictly better than today and should be recorded as a deliberate partial.
- Sequence AFTER TASK-710 if both land in this release. 710 extracts the shared membership helper, and doing 712 first means writing a third copy of the check that 710 then has to collapse.

Not a blocker for either, but note the persisted consequence: this string goes into messageMetadata.referencedMessages, so tightening the gate changes only NEW rows. Existing rows keep whatever they captured. That is consistent with the snapshot-at-resolution semantics the forwardedOriginCache docstring describes, and needs no backfill.
ASYNC RIPPLE MEASURED 2026-08-21, resolving the first of the two build-time questions above in favour of the full async gate. Traced the call chain by grep, each hop cited:

buildForwardMarker (SnapshotFormatter.ts:34, private, sync) <- formatSnapshot (SnapshotFormatter.ts:58, sync) <- appendForwardedSnapshots (ReferenceFormatter.ts:121, sync) <- format (ReferenceFormatter.ts:55, sync) <- MessageReferenceExtractor.extractReferencesWithReplacement:177, WHICH IS ALREADY ASYNC (declared async at :144).

So the ripple is exactly four sync methods becoming async, and it STOPS at line 177 with an added await - no caller past that point changes, because the nearest enclosing method is already async. ReferenceFormatter.format has exactly one production consumer (MessageReferenceExtractor), confirmed by grep for ReferenceFormatter across services/ and packages/ non-test. The sibling appendSingleReference is untouched.

That is bounded and tractable, so build the async version. The recorded fallback - gate on the synchronous ViewChannel half alone and accept private threads staying bot-cache-gated - is NOT needed and should not be reached for; it stays on the task only as the documented second-best if something unforeseen blocks the thread-through.

One thing the async conversion must not lose: format is sync today and its callers may rely on that only through the one call site above, but appendForwardedSnapshots loops over snapshots and mutates FormatState in order (s.nextNumber increments, trackLink last-write-wins). Awaiting inside that loop must keep the iteration SEQUENTIAL - a Promise.all over snapshots would reorder the numbering the comment at ReferenceFormatter.ts:132-134 depends on.
<!-- SECTION:DESCRIPTION:END -->
