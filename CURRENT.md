# Current

> **Session**: post-release reset (v3.0.0-beta.120 shipped 2026-05-11) — develop is now SHA-aligned with main. Next session starts from a clean slate; pick the next theme from active-epic / future-themes.
> **Version**: v3.0.0-beta.120 (released 2026-05-11)
> **🚧 Release freeze status**: LIFTED. No release in progress.

---

## Next Session Goal

**TTS Phase 2 — NeuTTS Air**: last remaining phase of the TTS Engine Upgrade epic. Self-hosted next-gen voice cloning engine alongside Pocket TTS, for free-tier voice-clone users. Plan-mode pending — needs design pass on (a) which model variant, (b) how it composes with the existing Pocket TTS path, (c) deployment shape (CPU vs GPU, model-size budget on Railway).

**Read first**:

- [`backlog/active-epic.md`](backlog/active-epic.md) — TTS Engine Upgrade epic; Phase 3 marked DONE, Phase 2 (NeuTTS Air) is the next checkpoint
- [`backlog/inbox.md`](backlog/inbox.md) — accumulated polish + UX follow-ups from the beta.120 cycle:
  - `/voice voices browse` UX overhaul (rename + select menu) — flagged during dev verification
  - `/voice view` structural improvements still landing in inbox (cascade labels, etc.)
  - `/inspect` views: inline-render small content, separate STT/TTS attribution from Token Budget
  - 4 reviewer items from release PR #1022 (stale JSDoc cols, retry-attempts naming, gt→gte note, CHECK constraint drift)
  - Several smaller polish items from prior PR cycles

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

_(none yet — develop is SHA-aligned with main at v3.0.0-beta.120)_

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007, drops 2 of the 3 columns added by #1005)
- `add_stt_provider_check_constraint` (#1008, defense-in-depth CHECK on `users.default_stt_provider_id`)
