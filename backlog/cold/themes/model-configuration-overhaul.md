### Theme: Model Configuration Overhaul

_Focus: remaining residuals of the completed Model Configuration Overhaul epic._

The vision-config epic itself SHIPPED (`VisionConfigResolver` + gateway stamping, capability validation, and the vision auto-fallback loop). The interim `kind` discriminator it introduced was retired 2026-07-05 (legacy-column retirement theme, #1499 + #1501 — capability + slot assignment replaced it; global preset names are one namespace; the slot vocabulary is `ModelSlot`). What remains here are the residuals that were never part of the shipped scope.

**DESIGNS ACCEPTED 2026-07-05**: the profiles + user-channel items below are designed in [`docs/proposals/backlog/llm-profiles-and-user-channel-tier.md`](../../../docs/proposals/backlog/llm-profiles-and-user-channel-tier.md) (profile = preset + tier-filtered fallback edge; Phase 0 = zero-schema tier-aware fallback closing the live BYOK gap; UserChannelConfig between user-default and user-personality). The server tier is designed in `config-cascade-semantics.md`. Free Model Quota Resilience is absorbed by that design's D2 switching layer. Sections below retained as background until the phases ship.

#### ✨ Config cascade extension — server, user-server, user-channel tiers

Current cascade: admin < personality < channel < user-default < user+personality. Missing tiers:

- **Server-level defaults** (server admins can set channel-scoped-to-guild defaults)
- **User-channel** (per-user per-channel, e.g., "1 week maxAge globally but off in #general")

User-default overriding channel is by design but limits power-user flexibility. Significant refactor — likely bundled with LLM Config Profiles since both change cascade shape.

#### ✨ LLM Config Profiles (Meta Configs)

Current LlmConfig is a single model. Redesign as **profiles** that bundle TEXT model configs — a named container with a description/purpose (e.g., "General Purpose", "NSFW", "Coding") holding a paid model config plus a free model config (fallback when quota/billing isn't available), so the system can auto-fallback and users pick a profile rather than individual models. **Vision is NOT bundled into profiles** — the "vision model inside a profile" shape was REJECTED (user decision 2026-06-26) in favor of the separate parallel vision axis that shipped (`kind='vision'` rows with their own defaults + cascade).

**Cascade integration**: profiles apply at all 4 config cascade levels — admin global default, personality default, user global default, user-personality override.

**User-facing**: admin creates global profiles (themed defaults everyone can use); users can create their own profiles (global/non-global, like personalities).

**Open questions**: relationship to the existing `Preset` system — replace, merge, or layer on top?; character-level free model default (does it exist today? needs investigation).

#### ✨ Free Model Quota Resilience

Automatic fallback to alternative free model on 402 quota errors. Track quota hits per model to avoid repeated failures. Foundation shipped in PR #587.
