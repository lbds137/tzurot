## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### 🐛 No live-failure listener for multi-tag slots — relies on 10-min safety timeout

Surfaced 2026-05-19 during PR #1063 (MultiTagRecovery BullMQ-state poll). When a multi-tag slot's BullMQ job fails during **normal operation** (not at restart — during live serving), nothing notifies `MultiTagCoordinator`. The slot stays in `'pending'` status until `handleSafetyTimeout` fires after `COORDINATOR_TIMEOUT_MS` (10 min), at which point the user gets a generic error.

`JobFailureListener` exists for single-tag jobs and successfully unblocks `ResponseOrderingService` on failure events from `QueueEvents`, but it explicitly does **not** integrate with the multi-tag coordinator — its comment at line 78-86 calls this out as "the typing indicator times out at TYPING_INDICATOR_TIMEOUT_MS and the orphan sweep releases the tracker slot — that's the existing behavior for failures; this fix doesn't make it worse."

Same UX symptom as the PR #1063 rehydration bug (10-min delay → generic error), but a separate root cause and a separate fix:

- **Rehydration bug**: result lost because new bot-client's stream subscriptions don't replay pre-shutdown events. Fixed in PR #1063 by polling BullMQ job state.
- **This bug**: failure event fires on `QueueEvents` while the slot is live, but no consumer routes it to `MultiTagCoordinator`.

**Fix shape**: add a multi-tag-aware listener (either extend `JobFailureListener` to consult `coordinator.jobToGroup` and route via `handleJobResult` with a synthesized failure `LLMGenerationResult`, or add a parallel listener owned by the coordinator). Either approach mirrors the synthesizeFailureResult pattern PR #1063 introduced — the call shape `coordinator.handleJobResult(jobId, { requestId, success: false, error })` is already tested.

**Why deferred**: the safety timeout still catches the failure eventually, so behavior is "slow error message" not "no error message." Lower urgency than the recoverability-loss this PR addressed.

**Promote when**: production logs show non-trivial frequency of live `failed` QueueEvents for multi-tag slot jobIds (grep `JobFailureListener` warn-level entries with `jobId` matching active-slot patterns), OR if user reports surface the 10-min delay pattern outside of restart scenarios.

**Start**: `services/bot-client/src/services/JobFailureListener.ts:87` (handleTerminalEvent) — the natural extension point is checking `coordinator.jobToGroup.has(jobId)` and routing through `coordinator.handleJobResult` instead of falling through to the single-tag-only `orderingService.cancelJob` path.
