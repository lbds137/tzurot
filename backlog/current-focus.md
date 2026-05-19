## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

#### 🐛 Poll BullMQ job state on `MultiTagRecovery` rehydration

When bot-client restarts (deploy, crash), `MultiTagRecovery` rehydrates the coordinator entry from Redis but only attaches a fresh `QueueEvents` subscription. `QueueEvents` is a stream — it does NOT replay events emitted before the listener attached. If the ai-worker on the OLD deploy completed the job AFTER bot-client SIGTERM'd (or while the new bot-client was warming up), the `completed` event is permanently lost. 10 min later `handleSafetyTimeout` fires with a synthetic timeout, the user sees an error message, and the actual generated response is silently dropped.

**Confirmed production failure mode** (2026-05-19 v3.0.0-beta.123 deploy):

- `05:16:15 UTC` — old bot-client SIGTERM'd, shut down cleanly
- `05:16:32 UTC` — old ai-worker completed job `llm-60db77c9...` (17s AFTER bot-client gone); result published to BullMQ with no consumer listening
- `05:26:25 UTC` — new bot-client `MultiTagCoordinator.handleSafetyTimeout` fired → user got an error in Discord; generated content lost

Reproducible on any deploy with in-flight jobs, so the next deploy will hit it again unless fixed.

**Fix shape**: when `MultiTagRecovery` rehydrates an entry, for each pending slot call `Job.fromId(jobId)` on the appropriate queue and check `getState()`. Branches:

- `'completed'` → fetch `job.returnvalue` and feed it through `handleJobResult` as if the live event had arrived
- `'failed'` → fetch `job.failedReason` and route through the failure path (same outcome `JobFailureListener` would have produced live)
- `'active' | 'waiting' | 'delayed'` → no-op; the `QueueEvents` subscription handles it from here as today
- `'unknown'` (job evicted from Redis) → treat as failed; the result is unrecoverable anyway

Adds 1 Redis read per pending slot on startup. Startup is rare; the failure mode is user-visible.

**Where**:

- `services/bot-client/src/services/MultiTagRecovery.ts` — `rehydrate` path; do the state poll after the slot's runtime registration but before the `QueueEvents` subscription "takes over"
- The queue handle is in `services/bot-client/src/index.ts` startup wiring (search for the `Queue` import from `bullmq`)
- Pair with a test that simulates: pending slot + queue state `'completed'` at rehydration → coordinator delivers via `handleJobResult`, no safety timeout fires

**Why this is in current focus, not deferred**: confirmed in-prod failure, deterministically reproducible on any deploy with in-flight jobs, user-visible (lost response + error message). PR #1062 makes the timeout error render in the persona's voice but doesn't recover the actual response — this PR does.

#### 🏗️ Resolve real persona UUID at recovery time (close synthetic-personaId FK violations)

**Gated on PR #1063 merge.** Promoted from `backlog/deferred.md` per user directive 2026-05-19 ("tackle the follow-up work immediately after this PR").

`MultiTagRecovery` builds slots with synthetic `personaId` strings (`recovery-persona-${personalityId}`, `recovery-revoked-${slug}`) for cases where the original `personaId` isn't recoverable from the snapshot. These strings fail Prisma's UUID FK constraint to `personas.id` when `saveAssistantMessage` runs. PR #1063 added symmetric try/catch protection on both `deliverSuccess` (new) and `deliverError` (pre-existing) paths so the user-visible behavior is correct (Discord message delivers; webhook already sent), but conversation history is silently dropped for any recovered slot.

**Fix shape**: inject `PersonaResolver` into `MultiTagRecovery` (already in the bot-client DI graph). In `recoverOne`, resolve the user's default `personaId` via `PersonaResolver` and use that as the slot's `personaId` instead of the synthetic strings. The personality is still rendered correctly via `slot.personality`; only the conversation-history FK changes. ~20-30 LOC + test.

**Why this completes the loop**: once recovered slots persist their messages correctly, recovery becomes fully transparent — no silent data loss, no asymmetric protection between `deliverSuccess` and `deliverError`. The try/catch wraps in PR #1063 become belt-and-suspenders rather than load-bearing.

**Start**:

- `services/bot-client/src/services/MultiTagRecovery.ts` — `rebuildSlot`, `buildRevokedSlot`, `buildPreservedTerminalSlot` all currently set `personaId` to a synthetic string
- `services/bot-client/src/composition.ts` `buildMultiTagRecovery` — add `personaResolver: PersonaResolver` to the deps
- `services/bot-client/src/index.ts` — thread `personaResolver` (already constructed at line 195) into `buildMultiTagStack`
- Test: replace synthetic-string assertions with the resolved-UUID expectation; add a test for "PersonaResolver returns null → fall back to current synthetic-string behavior so the slot still renders an error in the persona's voice"

**Why deferred entry was removed**: it's no longer "decided not to do yet" — it's the immediate next-up work. Originally surfaced 2026-05-16 PR #1034; widened scope 2026-05-19 by PR #1063 round-3 review (deliverSuccess path also affected).

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice using the reusable pattern from the 2026-05-13 NeuTTS Air probe. Plus verify Pocket TTS long-form support — current self-hosted might already cover the 1-4 min reply use case without any new engine.
2. **`/voice-references/:slug` enumeration risk** — the last remaining item from the API Security Hardening theme ([future-themes.md](future-themes.md)); rate limiter (PR #1046) + helmet/CORS (PR #1046/#1048) already shipped. Design-blocked on whether to bundle with the Character Visibility Toggle (icebox) — promote when there's appetite for the visibility-toggle question, OR if Railway logs surface an enumeration attempt.
3. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
