## 🎯 Current Focus

_This week's active work. Max 3 items._

### Active

#### 🏗️ Resolve real persona UUID at recovery time (close synthetic-personaId FK violations)

**Promoted from `backlog/deferred.md` per user directive 2026-05-19 ("tackle the follow-up work immediately after this PR"). PR #1063 merged 2026-05-19 — this is the immediate next pickup.**

`MultiTagRecovery` builds slots with synthetic `personaId` strings (`recovery-persona-${personalityId}`, `recovery-revoked-${slug}`) for cases where the original `personaId` isn't recoverable from the snapshot. These strings fail Prisma's UUID FK constraint to `personas.id` when `saveAssistantMessage` runs. PR #1063 added symmetric try/catch protection on both `deliverSuccess` (new) and `deliverError` (pre-existing) paths so the user-visible behavior is correct (Discord message delivers; webhook already sent), but conversation history is silently dropped for any recovered slot.

**Fix shape**: inject `PersonaResolver` into `MultiTagRecovery` (already in the bot-client DI graph). In `recoverOne`, resolve the user's default `personaId` via `PersonaResolver` and use that as the slot's `personaId` instead of the synthetic strings. The personality is still rendered correctly via `slot.personality`; only the conversation-history FK changes. ~20-30 LOC + test.

**Why this completes the loop**: once recovered slots persist their messages correctly, recovery becomes fully transparent — no silent data loss, no asymmetric protection between `deliverSuccess` and `deliverError`. The try/catch wraps in PR #1063 become belt-and-suspenders rather than load-bearing.

**Start**:

- `services/bot-client/src/services/MultiTagRecovery.ts` — `rebuildSlot`, `buildRevokedSlot`, `buildPreservedTerminalSlot` all currently set `personaId` to a synthetic string
- `services/bot-client/src/composition.ts` `buildMultiTagRecovery` — add `personaResolver: PersonaResolver` to the deps
- `services/bot-client/src/index.ts` — thread `personaResolver` (already constructed at line 195) into `buildMultiTagStack`
- Test: replace synthetic-string assertions with the resolved-UUID expectation; add a test for "PersonaResolver returns null → fall back to current synthetic-string behavior so the slot still renders an error in the persona's voice"

**Why deferred entry was removed**: it's no longer "decided not to do yet" — it's the immediate next-up work. Originally surfaced 2026-05-16 PR #1034; widened scope 2026-05-19 by PR #1063 (deliverSuccess path also affected, then mitigated symmetrically via try/catch in the merged PR — the try/catch is belt-and-suspenders pending this follow-up that closes the underlying FK violation).

### Most likely next-session pickups

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice using the reusable pattern from the 2026-05-13 NeuTTS Air probe. Plus verify Pocket TTS long-form support — current self-hosted might already cover the 1-4 min reply use case without any new engine.
2. **`/voice-references/:slug` enumeration risk** — the last remaining item from the API Security Hardening theme ([future-themes.md](future-themes.md)); rate limiter (PR #1046) + helmet/CORS (PR #1046/#1048) already shipped. Design-blocked on whether to bundle with the Character Visibility Toggle (icebox) — promote when there's appetite for the visibility-toggle question, OR if Railway logs surface an enumeration attempt.
3. **Voice references trim** ([inbox.md](inbox.md)): 8 personalities silently failing Mistral cloning (refs >30s). Owner-action only — no code work, but worth doing post-deploy to verify the audit tool's prod-side correctness.

### Other in-flight

_None._
