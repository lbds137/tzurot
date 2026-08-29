---
id: TASK-821
title: >-
  Rehydrated job result is dropped on delivery and then confirmed-delivered —
  reply permanently lost
status: To Do
assignee: []
created_date: '2026-08-29 17:08'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 821000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PROD BUG, observed live 2026-08-29 during the beta.210 deploy. Owner-reported ("looks like the rehydration may have gotten stuck"); the reply never arrived. Runtime-confirmed from prod logs, not code-read.

What happened, job llm-9c9b9fc0-ecf7-4b2a-a289-3ce82128c945 (personality Emily, jobTimestamp 2026-08-29T16:40:03.694Z — the second the deploy restarted services):

1. 16:45:26 ai-worker: "Job stalled (owning process died) — re-queued", then "Re-acquired own idempotency lock - job re-run after process death". WORKER-SIDE REHYDRATION WORKS.
2. Job ran to completion: 2 extended-context images processed, history 18, generation 33792ms, TTS rendered via mistral (audioSize=308526, Redis key tts-audio:llm-9c9b9fc0-...).
3. 16:46:11 "Job completed ... success=true"; result published to the Redis stream (messageId 1788021971567-0).
4. 16:46:15 bot-client ResultsListener "Received job result", then bot-client "Result for unknown job - delivering immediately", then MessageHandler "Received result for unknown job - ignoring".
5. api-gateway then logged "Job delivery confirmed" and POST .../confirm-delivery returned OK.

No webhook-send or message-sent line exists anywhere in that window — nothing reached Discord. The reply was generated, paid for (vision + generation + TTS), and dropped.

WHY THIS IS WORSE THAN NO FEEDBACK: step 5 marks the job delivery-confirmed, so the system believes the user was served and nothing will ever retry. Silent data loss with a success record.

Corroborating signal at restart: bot-client "Multi-tag recovery finished" reported entriesScanned=0 entriesResumed=0 staleJobIdsMarked=0 — the pending-request registry restored nothing across the restart, which is why MessageHandler had no record of the job.

TWO THINGS DELIBERATELY NOT ASSERTED (no code was read at filing time; verify before building): (a) WHY recovery scanned zero entries — whether the pending entry is never written for this request shape, or whether MultiTagRecovery only covers multi-tag requests and this was single-tag; (b) whether the persisted result remains retrievable for a manual redelivery, and under what TTL the Redis TTS entry expires.

Fix shape: NEEDS GROUNDING. Two separable defects — (1) the delivery path must be able to reconstruct a target for a completed job whose in-process record was lost to a restart (the durable job record exists on the gateway side); (2) confirm-delivery must NOT be called on a path that discarded the result — a drop must leave the job unconfirmed and retryable, so "ignoring" and "confirmed" can never both be true for one job.

Acceptance: a request in flight across a service restart is delivered to Discord after the worker rehydrates it; and if delivery genuinely cannot happen, the job is left unconfirmed (or surfaced as a failure) rather than marked delivered.

SCOPE: fires on EVERY deploy for any in-flight request — not specific to beta.210 contents. Owner call 2026-08-29: fix in beta.211. Same seam as TASK-820 (typing indicator on rehydrated pickup) — 820 is the symptom users see; this is the silent loss underneath.
<!-- SECTION:DESCRIPTION:END -->
