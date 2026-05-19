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

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice using the reusable pattern from the 2026-05-13 NeuTTS Air probe. Plus verify Pocket TTS long-form support — current self-hosted might already cover the 1-4 min reply use case without any new engine.
2. **API Security Hardening** ([future-themes.md](future-themes.md)): rate limiter + helmet/CORS + `/voice-references/:slug` enumeration risk. 3 items in a single security pass.
3. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
