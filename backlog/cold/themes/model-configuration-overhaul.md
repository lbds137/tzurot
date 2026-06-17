### Theme: Model Configuration Overhaul

_Redesign how models are configured. Bundle paid/free/vision into reusable profiles._

#### ✨ Vision model as a first-class config — decouple from LlmConfig (user direction 2026-06-16)

**Motivation (prod, 2026-06-16):** an image in an activated channel "didn't come through" because the personality's configured vision model (`qwen/qwen3.5-397b-a17b`, a 397B MoE) consistently exceeded the 90s vision budget and aborted → no description → the LLM improvised "image didn't come through." Diagnosed from prod ai-worker logs; the slug is valid + vision-capable, just too slow. Infra behaved correctly (retry + transient-timeout negative cache + graceful degrade). The manual fix today: change that personality's vision model to a faster one (e.g. `qwen/qwen3-vl-30b-a3b-instruct`).

**Near-term want — auto-fallback on vision failure:** when the configured vision model times out/errors, automatically try a different (faster/known-good) vision model instead of degrading to no-image. The user explicitly wants this — but "we'd need to do some cleanup to make it viable" because the vision model is currently glued to `LlmConfig` (no independent vision-model choice or fallback chain).

**Architectural goal (the cleanup):** make the vision model a **top-level, first-class config that parallels text models** — its own config/preset with **global default, free default, and per-user override via slash command**, exactly like the text-LLM-config surface. Vision selection should NOT be a field bolted onto `LlmConfig`; it's its own axis.

**Design tension to resolve vs the "LLM Config Profiles" sub-theme below:** that sub-theme proposes *bundling* the vision model INTO a profile ("changing the global vision model should be one action"). The 2026-06-16 direction is the opposite shape — a **separate parallel vision-config system**, not a field inside the text profile. Decide between them (separate surface vs bundled field) before building; separate-surface is the user's current preference. Auto-fallback then rides whichever surface wins (a fallback chain of vision configs).

**Fold-in — negative-cache key should include the resolved vision model:** `VisionDescriptionCache` keys failures by Discord attachment id / URL-hash only (`services/ai-worker/src/services/VisionDescriptionCache.ts`), NOT by model — so when a vision model is too slow and an image times out (negative-cached 10 min via the generic `VISION_FAILURE_TTL`), switching the configured vision model does NOT invalidate that image's cached failure; the same attachment replays the cached failure until the cooldown expires. Today that's a deliberate anti-re-hammer design and only bites during testing (re-upload the image = new attachment id = fresh attempt). Once vision becomes a first-class config (and especially with auto-fallback), the negative-cache key should incorporate the resolved vision model so a model swap / fallback re-attempts immediately instead of waiting out the cooldown. Surfaced 2026-06-16 during beta.133 dev-smoke vision-timeout.

#### ✨ Config cascade extension — server, user-server, user-channel tiers

Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers:

- **Server-level defaults** (server admins can set channel-scoped-to-guild defaults)
- **User-channel** (per-user per-channel, e.g., "1 week maxAge globally but off in #general")

User-default overriding channel is by design but limits power-user flexibility. Significant refactor — likely bundled with LLM Config Profiles since both change cascade shape.

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle paid + free models together, so the system can auto-fallback and users pick a profile rather than individual models.

**Core concept**: A profile is a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") that holds:

- Paid model config (model, temperature, max tokens, etc.)
- Free model config (fallback when quota/billing isn't available)
- Vision model config (bundled in — changing the global vision model should be one action, not per-LlmConfig)

**Cascade integration**: Profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override. Vision model inherits from the profile by default but users can override at any tier.

**User-facing**:

- Admin creates global profiles (themed defaults everyone can use)
- Users can create their own profiles (global/non-global, like personalities)
- `/preset` system may merge into or coexist with this

**Open questions**:

- Relationship to existing `Preset` system — replace, merge, or layer on top?
- How many vision profile themes are actually needed? (general, NSFW, document — or just general + NSFW)
- Character-level free model default (does it exist today? needs investigation)

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.

#### 🏗️ Vision Model as Full LLM Config

Currently vision model is just a model name string. Promote to a full `LlmConfig` reference (temperature, max tokens, system prompt, etc.) — but exclude the `visionModel` field itself (no recursive vision config). Likely folded into profiles above.
