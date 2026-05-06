# TTS Engine Upgrade Epic — Phase 3 + `/voice` Consolidation Plan

> **Status**: Architectural decisions locked 2026-05-05 (two council passes, Gemini 3.1 Pro Preview, sequential — first pass on parallel-vs-flag UX shape, second pass after scope expansion to consolidation). **Cleared for PR 1 plan-mode pass.**
> **Lifecycle**: Build-process doc — DELETE after Phase 3 PR 2 ships. Architectural rationale that should outlive the build moves to `docs/reference/architecture/` at that time.
> **Created**: 2026-05-05.

**Cross-references**:

- Phased plan summary: [`backlog/active-epic.md`](../../../backlog/active-epic.md).
- Original Phase 1 plan (still archival reference for the abstraction shape): [`tts-engine-upgrade-phase-1-plan.md`](tts-engine-upgrade-phase-1-plan.md).

---

## The decision in one paragraph

Phase 3 is no longer "flip STT consumer + add `/settings stt` parallel." Phase 3 is **two PRs**: PR 1 is a pure refactor that consolidates `/settings tts` and `/settings voices` into a new top-level `/voice` namespace with zero behavior change. PR 2 layers the Mistral STT cutover, the 4-layer resolver, and a new `/voice provider set <id>` bundled-default command on top of the now-clean namespace. The bundled-default semantic does NOT write to both TTS and STT fields — it writes to a single `default_provider` field that the resolver reads as Layer 3 of the chain, preserving the chain's integrity for subsequent surgical overrides.

## Why the consolidation, not parallel

Original framing was: "Phase 3 ships `/settings stt view/set/clear` parallel to `/settings tts`, escape valve preserved, minimal new surface." User pushed back: "if `/settings voice` is cleaner, why don't we refactor to that?" — citing project precedent of `/preset` already being top-level alongside a thinner `/settings preset` alias.

Grepping the command tree surfaced that **`/settings` has TWO voice-related subgroups today**, not one:

- `/settings tts` — TTS provider/config: browse, default, set, reset, clear-default
- `/settings voices` — persona voice management: browse, clear, delete (reference audio + cloned voice slot lifecycle)

That makes the consolidation opportunity bigger than originally framed: a unified `/voice` namespace can absorb both, plus add the new STT pieces, in one coherent domain. Council validated this shape on the second pass.

The Discord 3-level nesting limit (command → subcommand-group → subcommand) is NOT constraining for this shape because Discord allows mixing direct subcommands and subcommand groups under one command. `/voice browse` (direct subcommand) and `/voice provider set` (group + subcommand) coexist cleanly under `/voice`.

## The proposed shape

```
# Direct subcommands (voice lifecycle — migrated from /settings voices)
/voice view                  — full matrix dashboard: resolved TTS + STT + cloned voices
/voice browse                — paginated list of cloned voices
/voice clear <slug>          — clear reference audio for a slug
/voice delete <slug>         — delete a cloned voice slot

# Subcommand groups (provider config — migrated from /settings tts + new STT)
/voice provider set <id>     — bundled default (writes single `default_provider` field, Layer 3)
/voice provider clear        — clear bundled default
/voice tts set <id>          — TTS-specific override (migrated from /settings tts set)
/voice tts clear             — TTS override clear (consolidates clear-default + reset)
/voice stt set <id>          — STT-specific override (NEW, Layer 1 escape valve)
/voice stt clear             — STT override clear
```

`/voice view` is a single dashboard embed with sections for: active TTS provider (resolved + source layer), active STT provider (resolved + source layer), and a summary of cloned voices ("3 active clones: [slug1], [slug2], [slug3]" — with pagination handoff to `/voice browse` if the list is long).

## The two-PR slicing

**PR 1 — Pure refactor (zero new behavior)**:

- Move `/settings tts/*` handlers → `/voice tts set`, `/voice tts clear`. Consolidates the existing `clear-default` + `reset` into one `clear` per the shape above.
- Move `/settings voices/*` handlers → `/voice browse`, `/voice clear <slug>`, `/voice delete <slug>`.
- Add `/voice view` dashboard (single embed: provider state + cloned-voice summary).
- Replace old `/settings tts` and `/settings voices` with **deprecation stubs**: subcommands still register but reply ephemerally with `"This command has moved to /voice ...". Use /voice view to see your voice settings.` Schedule stub removal ~1 month after PR 1 ships (filed in inbox).
- No resolver logic change. STT still ElevenLabs Scribe. No Layer 1 override exists yet (the `/voice stt` group doesn't exist in this PR).
- Tests: every migrated handler keeps its colocated `.test.ts`. Command registration tests verify the new tree. Snapshot test in `CommandHandler.int.test.ts` updates.

**PR 2 — Phase 3 STT cutover + provider-set semantic**:

- Add `/voice provider set <id>` and `/voice provider clear`. `set` writes a single `default_provider` field on the user record (or wherever the cascade reads from — confirm during plan-mode).
- Add `/voice stt set <id>` and `/voice stt clear` (Layer 1 explicit override).
- Wire the 4-layer STT resolver into `AudioProcessor.transcribeAudio`:
  1. User explicit STT override (from `/voice stt set`)
  2. Derive from TTS provider (read user's TTS config; if Mistral, use Mistral STT)
  3. Admin/system `default_provider` (from `/voice provider set`)
  4. voice-engine fallback (free tier)
- Flip STT path: `AudioProcessor.transcribeAudio` consumer call goes from ElevenLabs Scribe → Mistral Voxtral Transcribe via the resolver.
- JIT teaching: `/voice tts set` success message gains a one-line "ℹ️ Note: STT provider is also Mistral now (derived). Run `/voice stt set` if you want to override." when the change cascades.
- Telemetry: log line for STT calls parallel to existing TTS cost telemetry from Phase 1.

## Bundled-default semantic (architecturally important)

When `/voice provider set mistral` runs, the implementation does NOT write `mistral` to both `tts_provider` and `stt_provider` columns. It writes to a single distinct `default_provider` field, which the resolver reads as Layer 3.

**Why this matters**: writing to both fields explicitly destroys the resolution chain's integrity. A subsequent `/voice stt clear` would null the STT field, skipping straight to Layer 4 (voice-engine fallback) instead of correctly resolving back through Layer 3 (admin default) or Layer 2 (TTS-derivation).

Council's framing: `/voice provider set` is the _foundational default_. `/voice tts set` and `/voice stt set` are _surgical overrides_ layered above it. Each subcommand owns exactly one field; the resolver's job is to walk the chain.

## Discord-specific gotchas to handle

1. **Client-side command cache**: Discord desktop/mobile clients aggressively cache command trees. Post-deploy, users may see ghost old commands until they Ctrl/Cmd+R (desktop) or restart the app (mobile). Mitigation: post a one-line "after deploy, please refresh Discord" in the bot's announcement channel when PR 1 ships. Single-digit userbase makes this manageable.
2. **Global vs guild command propagation**: global commands take up to 1 hour to propagate. If the bot is only in a few guilds, registering as guild commands during the migration window gives instant updates. Confirm current registration mode during plan-mode pass.
3. **Deprecation stubs, not deletion**: don't just delete `/settings tts` and `/settings voices` in PR 1. Keep them registered with handlers that reply ephemerally pointing at the new commands. Backlog item filed for stub removal ~1 month later.

## What plan-mode tomorrow needs to verify

- Current `/settings` registration mode (global vs guild) → determines deploy strategy for PR 1.
- The exact field on the user/persona record where `default_provider` would land. Is there an existing `default_*_id` field that maps cleanly, or does PR 2 need a Prisma migration to add `default_provider`? (PR 1 is migration-free; if migration needed, it goes with PR 2.)
- Whether `CommandHandler.int.test.ts` snapshot will update cleanly or needs targeted re-snapshotting.
- File-move count under `services/bot-client/src/commands/settings/tts/` and `services/bot-client/src/commands/settings/voices/` — sets the review surface size for PR 1.
- Whether `/voice view` should fetch cloned-voice summary inline or defer to `/voice browse` for non-trivial counts. Performance check on a typical voice-list query.

## Council pass references

Two sessions, both Gemini 3.1 Pro Preview, 2026-05-05:

- **Pass 1** (initial UX-shape question): A/B/C options for parallel `/settings stt` surface. Council recommended Option B (minimal: `view`/`set`/`clear`) with JIT ephemeral teaching in `view` embed and `/settings tts set` success message. Validated layer 1 preservation via concrete user-story (accent/mic-quality requiring STT override independent of TTS choice). Rejected `--stt-override` flags-on-TTS approach due to state-management confusion.
- **Pass 2** (after scope expansion to consolidation): Reversed slicing recommendation from "one big PR" → "Option 3: refactor first, feature second" for blast-radius isolation. Corrected the bundled-default semantic from dual-field-write to single-field-write. Confirmed unified `/voice view` dashboard (single embed) over separate `/voice provider view` + `/voice voices view`. Surfaced Discord client-cache mitigation tactics (Ctrl+R, guild commands, deprecation stubs).

Both passes' full Q+A logs preserved in conversation memory for the 2026-05-05 session; if needed for archeology, retrieve from session record.
