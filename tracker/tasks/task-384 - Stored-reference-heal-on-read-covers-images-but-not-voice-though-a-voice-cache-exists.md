---
id: TASK-384
title: >-
  Stored-reference heal-on-read covers images but not voice, though a voice
  cache exists
status: To Do
assignee: []
created_date: '2026-08-01 00:59'
updated_date: '2026-08-04 13:49'
labels:
  - 'size:S'
  - 'area:ai-worker'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 384000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-31 in #1883's fourth review round.**

`storedReferenceHydrator.resolveVisionDescriptions` heals a stored reference's `attachmentEnrichment` from `VisionDescriptionCache` when the row carries none — but only for IMAGE attachments. A row whose voice note was never persisted (anything written before #1883) has no heal-on-read path at all.

**The reviewer assumed there was nothing to heal from. There is.** `VoiceTranscriptCache` (`packages/common-types/src/services/VoiceTranscriptCache.ts`) is Redis-backed and URL-keyed via `deriveAttachmentCacheKey` — structurally the same shape as the vision cache, 1h TTL. So the asymmetry is an omission, not a constraint.

**Why it was left out of #1883:** closing it needs a `VoiceTranscriptCache` threaded into `hydrateStoredReferences`, which today takes only `visionCache` — a new dependency at a hydration call site, which is a semantic change rather than a review-rider.

**How much it actually buys:** limited. The heal path only helps a row younger than the cache TTL (1h), and by ~2026-09-01 every row predating #1883 will have aged out of the 30-day history window entirely, at which point this closes itself. Promote if the owner reports a quoted voice note replaying as `status="untranscribed"` before then.

**Ride-along when this is picked up:** `.claude/rules/03-database.md`'s cache table lists `Voice Transcript | VoiceTranscriptCache.ts | - | Custom (in-memory)`. That row is wrong on both the TTL and the tier — it is Redis-backed with a 1h TTL. Rules files are review-gated, so the correction needs a PR.
<!-- SECTION:DESCRIPTION:END -->
