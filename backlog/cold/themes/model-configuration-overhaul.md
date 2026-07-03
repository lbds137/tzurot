### Theme: Model Configuration Overhaul

_Focus: remaining residuals of the completed Model Configuration Overhaul epic._

The vision-config epic itself SHIPPED (the `kind: 'text' | 'vision'` discriminator on `llm_configs`, `VisionConfigResolver` + gateway stamping, kind-aware service/route/command threading, capability validation, and the vision auto-fallback loop). What remains here are the residuals that were never part of the shipped scope. (The related expand-contract cleanup is its own theme: `llm-config-legacy-column-retirement.md`.)

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
