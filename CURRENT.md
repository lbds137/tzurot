# Current

> **Version**: v3.0.0-beta.123 (released 2026-05-19) — 10-PR sweep cycle. Multi-personality ping race fix (#1049) shipped to prod. Cross-channel history ordering + voice transcript tagging (#1056), free-tier vision constant bump (#1057), forwarded-message activation slot (#1058), and `JobFailureListener` (#1053) all live.
> **🚧 Release freeze status**: LIFTED. No release in progress. Prod auto-deploy from main → prod completing now.

---

## Next Session Goal

**Open** — inbox is empty as of 2026-05-19. Pick from:

1. **`/admin metrics` Discord command** ([quick-wins.md](backlog/quick-wins.md)) — bot-owner-only slash command that fetches `/metrics` and renders an embed. ~1-2hr. Original trigger ("wait until prod-issue ping race resolved") is now met.
2. **Self-Hosted TTS + BYOK Re-Eval — Step 0 probes** ([future-themes.md](backlog/future-themes.md)) — hands-on probe of OmniVoice / F5-TTS / CosyVoice (30 min each).
3. **User-feedback solicitation + revive v2 release-notes delivery** ([future-themes.md](backlog/future-themes.md)) — DM blast mechanism + release announce. Multi-PR epic.
4. **Deferred items with named triggers** ([deferred.md](backlog/deferred.md)) — many are gated on "next time you touch X." Check the list when picking up new work.

**Verify on prod after deploy completes**:

- Multi-personality ping race fix ([production-issues.md](backlog/production-issues.md) entry pending verification — ping 2-3 personalities in quick succession with different prompts; each should reply with its own content)
- `google/gemma-4-31b-it:free` is a real slug (confirmed via preset screenshot 2026-05-19; verify guest-mode vision works in prod for paranoia)

---

## Last Session — v3.0.0-beta.123 sweep (2026-05-18 → 2026-05-19)

Marathon sweep cycle: started with intake from a personal-notes review of recent UX issues, shipped 10 PRs over ~24 hours.

### PRs merged

| PR    | Title                                                                        | Domain                    |
| ----- | ---------------------------------------------------------------------------- | ------------------------- |
| #1051 | `chore(api-gateway): /metrics housekeeping`                                  | Internal API auth         |
| #1052 | `fix(ai-worker): bound voice-engine STT retry loop`                          | Voice STT                 |
| #1053 | `fix(bot-client): unblock channel queue when AI job fails`                   | Multi-personality routing |
| #1054 | `chore(deps): bump production-dependencies` (×7)                             | Deps                      |
| #1055 | `chore(deps-dev): bump development-dependencies` (×14) + knip 6.14.1 fallout | Deps + ci hook            |
| #1056 | `fix: cross-channel history ordering + voice transcript tagging`             | Conversation context      |
| #1057 | `fix(ai-worker): cache header-less 429s + bump free gemma constant`          | LLM provider              |
| #1058 | `fix(bot-client): activation slot on forwarded messages`                     | Discord routing           |
| #1059 | `chore(bot-client): polish /admin db-sync embed truncation`                  | Admin UX                  |
| #1060 | `v3.0.0-beta.123` (release PR, develop → main)                               | Release                   |

Plus PR #1049 (per-result `deliverFn` for multi-personality race) which landed on develop earlier and shipped in this release.

### Backlog state after sweep

- **Inbox**: empty (last swept 2026-05-19)
- **Deferred**: 86 trigger-gated items (10 added this cycle)
- **Quick wins**: 2 items (`/admin metrics`, retry-on-inadequate-LLM-response)
- **Production issues**: 1 entry pending prod verification (multi-personality ping race — fix shipped, verify post-deploy)

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the previous development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007)
- `add_stt_provider_check_constraint` (#1008)

No new migrations in v3.0.0-beta.121, beta.122, or beta.123.
