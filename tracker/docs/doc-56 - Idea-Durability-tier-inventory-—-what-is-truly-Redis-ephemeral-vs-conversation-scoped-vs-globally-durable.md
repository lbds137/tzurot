---
id: doc-56
title: >-
  Idea: Durability-tier inventory — what is truly Redis-ephemeral vs
  conversation-scoped vs globally durable
type: other
created_date: '2026-07-31 00:33'
---

**Owner-requested 2026-07-30**, during the TASK-364 investigation: _"I think
we've been leaning too hard on Redis for some things and we really need to take
a proper inventory of what is truly Redis ephemeral vs conversation history tier
ephemeral. and I think transcripts should be db backed."_

## Why the existing audit does not answer this

[`docs/reference/architecture/CACHING_AUDIT.md`](../../docs/reference/architecture/CACHING_AUDIT.md)
exists and inventories every cache — but it is dated **2025-12-20** and, more
importantly, it is built on the wrong axis. Its question is _"what breaks under
horizontal scaling?"_ (in-memory vs Redis, per-replica staleness, pub/sub
invalidation). Its headline finding was the channel-activation cache, since
resolved. That axis has nothing to say about **durability**: a Redis entry and a
DB row look identical to a scaling audit and are completely different when the
question is "what happens when this is lost."

So this is not a refresh of that doc. It is a second pass on a different axis,
and it should either extend that file with a durability column or supersede it.

## The proposed axis

Not storage mechanism. **Cost of loss × natural lifetime.** Three tiers:

| Tier | Test | Home | Examples |
| --- | --- | --- | --- |
| **1 — truly ephemeral** | recomputable for free; losing it is correctness-neutral | in-memory or Redis, short TTL | autocomplete lists, model-capability flags, rate-limit counters, in-flight/single-flight markers |
| **2 — conversation-scoped durable** | costs money or real latency to regenerate, AND is meaningful exactly as long as the conversation it belongs to | **the conversation-history row**; dies with it at `DAYS_TO_KEEP_HISTORY` | vision descriptions, voice transcripts |
| **3 — globally durable** | costs money to regenerate, and the underlying asset is immutable and shared across users/servers | own table, no TTL, successes only | sticker descriptions (doc-55 PR-2) |

**The sorting question**: _if this is lost, does someone pay again — and does the
thing it describes outlive the conversation?_ Two yeses → tier 3. Pay-again but
conversation-bound → tier 2. Neither → tier 1.

Redis then has one honest job: an **L1 accelerator** in front of tiers 2 and 3,
never the system of record for either. That is exactly what `VisionDescriptionCache`
already is on its read path (canonical entry, tier promotion) and what it is NOT
on its durability path (1h TTL, nothing behind it).

## Known tier-2 violations at filing time

- **Voice transcripts — the owner's named case.** `VoiceTranscriptCache`
  (`packages/common-types/src/services/VoiceTranscriptCache.ts`) is pure Redis,
  `setex` at `INTERVALS.VOICE_TRANSCRIPT_TTL` (1h), with no durable tier behind
  it. Partially mitigated by accident: a voice message that has its OWN history
  row carries its transcript as that row's `content` (the DB-tier retriever in
  `referenceEnricher` relies on this — "the row IS the transcript"). But
  `StoredReferencedMessage` has **no** `resolvedVoiceTranscripts` field, unlike
  its `resolvedImageDescriptions` — so a transcript is not carried as structured
  data on a stored reference the way a description is. Asymmetric by accident,
  not by design. **Resolution rides with TASK-367** (persisting the built
  reference covers images and transcripts by the same mechanism).
- **Vision descriptions** — 1h Redis with no durable tier; TASK-367 is the fix.
  Note a Postgres L2 existed here and was removed in beta.110 for reasons that
  were about persisted FAILURES and unstable keys, not about durability itself.

## Scope

The inventory pass, not the remediation. Walk every cache, assign a tier, and
file a task per violation. Two things to decide while walking, because they set
the pattern for the rest:

1. Does a tier-2 item ever get its own table, or is inline-on-the-row always
   right? (The TASK-367 council answer says inline, for the no-key-dimension and
   free-retention properties — check whether that generalizes.)
2. Does `CACHING_AUDIT.md` gain a durability column, or does this replace it?
   It is 7 months stale either way.
