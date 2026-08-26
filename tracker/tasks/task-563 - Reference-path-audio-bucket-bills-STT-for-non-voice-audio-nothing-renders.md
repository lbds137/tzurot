---
id: TASK-563
title: Reference-path audio bucket bills STT for non-voice audio nothing renders
status: Done
assignee: []
created_date: '2026-08-12 22:33'
updated_date: '2026-08-21 23:15'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 563000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pre-existing cost gap surfaced by the #2056 seam trace - same class as the shipped TASK-512, one predicate over. categorizeAttachments (jobChainOrchestrator.ts:51-56) enqueues billed STT for ANY audio/* attachment on a referenced message, but the ai-worker reference render path consumes transcripts only for isVoiceMessage === true (classifyAttachment in QuoteFormatter.ts:108-119; findPreprocessedByUrl is the sole reference-transcript consumer, reached only via the voice arm). So an mp3 in a quoted message triggers real STT spend whose output is discarded. Related asymmetry worth a comment: the gateway assistant-reference skip covers ALL audio while the worker guards voice-only - benign today, a latent drift point if a non-voice reference-audio consumer is ever added.

Fix shape: gate the reference-path audio bucket on isVoiceMessage, mirroring classifyAttachment; add the scope comment.

Acceptance: non-voice reference audio creates no STT job (pinned); current-message audio path unchanged. Source: 2026-08-12 review (api-gateway reviewer MED-1 PLAUSIBLE code-read + LOW-1 CONFIRMED).

TRACE (2026-08-13) - the CONSEQUENCE holds, the stated MECHANISM does not. Implementation attempted and parked; see BLOCKER below.

The filing describes an intra-api-gateway asymmetry: reference path buckets all audio, current-message path gates on isVoiceMessage. That is wrong. There is no separate reference-path bucketer at all - collectPreprocessingJobs calls the SAME processAttachmentsForJobs for the trigger message and for each referenced message, and both funnel into one categorizeAttachments which buckets any audio/* regardless of path. classifyAttachment is not the current-message gate either: it lives in ai-worker (QuoteFormatter.ts:108-119) and is a RENDER-side function in a different service.

The real shape is a producer/consumer mismatch across two services. The spend is dispatched identically for both paths; what differs is who consumes it. Current-message audio IS consumed - RAGUtils.formatProcessedAttachmentEntry renders every Audio entry as voice_transcripts with no isVoiceMessage condition. Reference audio is NOT - both reference render arms drop it. Full render: AttachmentProcessor.processSingleAttachment switches on classifyAttachment and returns a bare file entry, never reading the transcript. Deduped render: buildRenderableAttachments does the same, and because its describe callback runs unconditionally and calls matched.add(hit), the orphan-recovery loop skips it too. The warnOnDroppedEnrichment tripwire excludes file from its denominator, so the drop is silent by design. So: money spent, output discarded, no warning.

isVoiceMessage IS reliably populated on the reference path - attachmentExtractor.ts:38 assigns it on EVERY attachment (isVoiceMessage: isVoiceAttachment(attachment)), always a boolean, and MessageFormatter.extractAttachments feeds both the direct and forwarded reference arms. Gating on it suppresses only non-voice audio; real voice messages carry true. Precedent: extendedContextAttachmentCollector.ts:43 already filters extended-context audio the same way.

The gate must be REFERENCE-SCOPED, not applied inside categorizeAttachments - the current-message path has a live consumer, so gating there would be a functionality regression rather than a fix.

BLOCKER - two enforced tests encode the pre-fix behavior, and both fixtures are wrong about the real producer:
1. BullMQJobChainContract.producer.test.ts envelope-referenced-attachments - its reference-2 fixture is captioned as a voice note with ref-voice.ogg but OMITS isVoiceMessage, an input bot-client never produces. Its snapshot (bullmq-job-chain/envelope-referenced-attachments.json) is also consumed by the ai-worker consumer contract test and tests/e2e/contracts, so the regeneration is three-way.
2. jobChainOrchestrator.property.test.ts - the oracle lives in packages/test-utils/src/jobContextArbitraries.ts. ArbAttachment has no isVoiceMessage field at all, and describableReferenceNumbers counts any reference audio/* as describable.

Both need STRENGTHENING (making the fixtures match what the producer actually emits) rather than weakening, and ArbAttachment must generate the flag BOTH ways so the property still exercises the distinction. That is cross-package test-infrastructure work well beyond the size:S label - relabel to size:M when picked up.

THE IMPLEMENTATION ALREADY EXISTS - do not rewrite it from scratch. The gate plus five tests are committed as 0f7d16d00 on the LOCAL branch fix/task-563-reference-audio-voice-gate. It is deliberately unpushed: the two enforced tests above are red, so the pre-push gate would reject it and skipping hooks is not an option. The branch is local-only, which means it survives worktree removal but not a branch deletion - if it ever goes missing, git reflog or git fsck --lost-found will still hold the commit. Its base is 10 commits stale (the beta.200 bump), so rebase onto develop before resuming. Resuming means: rebase, fix the two fixtures per the blocker above, then the branch is pushable.
CORRECTION 2026-08-20, verified against git rather than recalled. The paragraph above says the branch is deliberately unpushed and local-only, and that it survives worktree removal but not a branch deletion. That is FALSE. origin/fix/task-563-reference-audio-voice-gate exists and its tip is byte-identical to the local tip (0f7d16d0088edeaf3a8048b0b328a8c82056baa0), so the work is not at risk and needs no reflog rescue. How it got pushed with two tests red is not established - do not record a cause. The branch carries exactly ONE commit ahead of develop and is several hundred behind, so the resume is a rebase onto current develop, not the ten-commit gap the paragraph estimates. Deliberately NOT recording the behind-count: it re-stales every time develop moves, and a stale number in a durable surface reads as fact. Derive it when picking this up: git rev-list --left-right --count origin/develop...origin/fix/task-563-reference-audio-voice-gate. Re-verified 2026-08-21 that origin still holds the branch at 0f7d16d00, tip unchanged.

SECOND CORRECTION 2026-08-26 — the paragraph above is now FALSE in the other direction, and this one is the dangerous version. `git ls-remote --exit-code --heads origin fix/task-563-reference-audio-voice-gate` returns 2: **the remote branch is GONE.** `git branch -a --contains 0f7d16d00` returns nothing, so that commit is a dangling object with no ref pointing at it, alive only until the next gc. Do not record a cause for the deletion; it is not established.

The work survives because a second copy existed: the harness worktree branch from the session that authored it, carrying the identical change as `673d372dc` (verified identical to 0f7d16d00 by `git patch-id --stable` — same patch id `bebfdfbcb2db8d6…`, different commit sha because the commit message differs). That branch was found during a stale-branch sweep on 2026-08-26, when 27 of 28 `worktree-agent-*` branches were deleted as superseded; this one was the sole survivor precisely because a patch-id check against develop flagged it as genuinely unmerged.

It is now renamed to the meaningful **local** branch `fix/task-563-reference-audio-voice-gate` @ `673d372dc`. That is a SINGLE LOCAL COPY on one machine — the state the first correction wrongly believed had been escaped. It is still unpushed for the original reason (two enforced tests are red, so the pre-push gate rejects it, and skipping hooks is not an option).

Resume unchanged in substance: rebase onto current develop, strengthen the two fixtures per the blocker above, then it becomes pushable. Derive the behind-count when picking it up rather than trusting a number here: `git rev-list --left-right --count origin/develop...fix/task-563-reference-audio-voice-gate` (note: no `origin/` on the right any more).
<!-- SECTION:DESCRIPTION:END -->
