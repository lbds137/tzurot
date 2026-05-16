# Current

> **Session**: 2026-05-16 — shipped PR #1035 (webhook-suffix parser drift + footer context-leak + `/character chat` polish + STT footer toggle + tier-2 reply resolution in guilds) and follow-up PR #1036 (JSDoc polish + filter-error wording). PR #1035 surfaced from a user-observed multi-tag ordering bug in a guild activated channel; root cause was a missed-grep when the webhook separator changed from `|` to `·` — three parsers had to agree but only one was updated. Fix centralizes separator knowledge in a shared util keyed on the bot's tag. **Release readiness**: ready to cut v3.0.0-beta.122 once #1036 merges.
> **Version**: v3.0.0-beta.121 (released 2026-05-15)
> **🚧 Release freeze status**: LIFTED. No release in progress (v3.0.0-beta.122 ready to cut after #1036 lands).

---

## Next Session Goal

**Release v3.0.0-beta.122** once PR #1036 merges. Then open to:

1. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](backlog/future-themes.md)): hands-on probe (30 min each) of OmniVoice / F5-TTS / CosyVoice using the reusable pattern from the 2026-05-13 NeuTTS Air probe. Plus verify Pocket TTS long-form support — current self-hosted might already cover the user's 1-4 min reply use case without any new engine.
2. **API Security Hardening** ([future-themes.md](backlog/future-themes.md)): rate limiter + helmet/CORS + `/voice-references/:slug` enumeration risk. 3 items in a single security pass.

**Read first**:

- [`backlog/active-epic.md`](backlog/active-epic.md) — TTS Engine Upgrade epic; Phase 1 + 3 ✅, Phase 2 (NeuTTS Air) ABANDONED with full evidence
- [`backlog/future-themes.md`](backlog/future-themes.md) — refreshed "Self-Hosted TTS + BYOK Re-Eval" theme with NeuTTS Air abandon evidence + Step-0-probe-required directive + candidate list
- [`backlog/quick-wins.md`](backlog/quick-wins.md) — empty
- [`backlog/deferred.md`](backlog/deferred.md) — 3 new deferred items from #1035 review cycle (convertMessage extraction, tier-2 latency monitoring, cachedBotSuffix hard invariant)

---

## Last Session (2026-05-09 → 2026-05-11, extended marathon)

Shipped v3.0.0-beta.120 — TTS Phase 3 end-to-end, 3-PR cross-channel context bug-fix arc, 2-PR Mistral STT critical fix arc, TTS-side attribution mirror (#1016), focused TTS/STT inbox sweep (#1017), coordinated UX rename `personality → character` + `browse → list` (#1020), pre-release sweep (#1021 — deprecation stub removal + 8 user-facing string leaks fixed + `/voice view` structural overhaul). **17 merged PRs total** + 2 dependabot bumps.

**Key shipped fixes:**

- **Mistral STT now actually works** — model ID was invalid since the feature shipped (`voxtral-mini-transcribe-latest` doesn't exist; correct alias is `voxtral-mini-latest`). Every "Mistral STT" request had silently fallen through to voice-engine. Discovered via user observation "Mistral seems identical to self-hosted" → #1014 attribution fix (which exposed the deeper #1015 bug).
- **Cross-channel history works for the configured-but-stale case** — three interlocking bugs fixed: `getChannelHistory` ignored `maxAge` at DB layer; cross-channel budget was a residual of current-channel; `getCrossChannelHistory` had no time filter. New `computeHistoryCutoff` helper as single source of truth (#1011 + #1012).
- **Silent-fallback visibility** — both STT (#1014) and TTS (#1016) now surface the actual provider used (not just the requested provider) in `/inspect` Token Budget. Catches the same misattribution class that hid the Mistral STT bug.
- **`/voice` namespace consolidation** — `/settings tts` + `/settings voices` moved under unified `/voice` (#1003); STT cascade simplified to 3-layer speaker-bound (#1007).
- **Bot-owner notices for silent provider degradations** — Mistral 30s reference-audio overflow now surfaces a bot-owner-visible notice (#1010 + #1017 closed the slash-job delivery gap).
- **UX vocabulary consistency** — `personality → character` across ~75 slash command UX sites + 8 embed/footer text leaks (#1020 + #1021); `browse → list` for override-listing commands. Internal types preserved.
- **Deprecation stubs removed** — pre-deploy `/settings tts` + `/settings voices` redirect stubs cleaned out (#1021); legacy paths now surface Discord's "Unknown command" UI.
- **README + new `docs/commands.md`** — full README refresh (Mistral promoted to primary BYOK voice; Shapes.inc origin story de-emphasized; slash command tables extracted to dedicated reference).

**Critical-bug discovery insight:** two interlocking silent-skip bugs masked each other for ~2 months until user observation. The diagnostic surfaces from #1014/#1016 + the canary backlog item are the structural fixes preventing the next instance.

---

## Unreleased on Develop

**v3.0.0-beta.122 candidates** (since v3.0.0-beta.121):

- **#1035** — webhook-username parser unification (root-cause fix for multi-tag slot-0 ordering bug in guild activated channels); extended-context footer-leak strip (Emily-roleplay-around-footer); `/character chat` ephemeral random-pick notice + new `only-mine` filter; STT attribution footer gated on `showModelFooter` user-default; tier-2 reply-resolution DB lookup now runs in guild channels too.
- **#1036** — JSDoc polish + filter-error wording cleanup follow-up.

No prisma migrations in this delta — no `pnpm ops db:migrate` step needed post-merge.

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007, drops 2 of the 3 columns added by #1005)
- `add_stt_provider_check_constraint` (#1008, defense-in-depth CHECK on `users.default_stt_provider_id`)
