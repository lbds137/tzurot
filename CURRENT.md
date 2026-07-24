# Current

> **Version**: v3.0.0-beta.175 (released 2026-07-23) — retention Phase 1 + security hardening. Retention tracking substrate (`lastActiveAt`/`dmUndeliverableSince`, historical backfill, forward stamps; invisible, no purge — #1764–#1767) · Discord `20026` → distinct `failed_bot_level` DM outcome (#1774) · fail-closed `OUTBOUND_DM_ALLOWLIST` boot guard (#1769) · 7 Dependabot advisories + 17 unbounded overrides bounded (#1768, #1773). Two additive migrations premigrated; **270 prod users backfilled**. **Rotzot un-quarantined** — the beta.175 release DM delivered, so 20026 handling is dormant-but-correct defense.

---

## Unreleased on Develop

- **#1778 — conversation-history sync unification** (Phase 1.5): `conversation_history` became a normal db-sync table (`updated_at` LWW + generalized AFTER-DELETE trigger); retired the bespoke soft-delete tombstone system, `tombstoneUtils.ts`, `cleanupOldTombstones`, and `/admin cleanup tombstones`. Round-trip component test proves soft- and hard-delete propagate without resurrection — closes a latent account-purge gap. Net −782 lines. ✅ Dev migration applied.
- **#1779 / #1780 / #1781 — retention Phase 2 PR-A/B/C** (detail in the epic section below). ✅ Dev migrations applied.
- **#1782 / #1783 — always-loaded context trim, rounds 1 and 2** (see the trim section below).

## 🎯 Active epic — Automated Inactivity Retention & Purge

Design ACCEPTED 2026-07-23 (council trio + 6 owner calls) → [`inactivity-retention-purge-phase2.md`](docs/proposals/backlog/inactivity-retention-purge-phase2.md).

| Slice                                                                                                                                                                      | State                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Phase 1 (1a–1d) tracking substrate                                                                                                                                         | ✅ released beta.175; prod backfilled 270 users |
| Phase 1.5 CH sync unification (#1778)                                                                                                                                      | ✅ merged                                       |
| PR-A schema (#1779) — `discord_account_gone_at`, `retention_exempt`, `original_owner_discord_id`, `retention_purge_log`                                                    | ✅ merged                                       |
| PR-B mode-aware erasure (#1780) — `AccountEraserService` unifies DB+off-DB (D1); `retention` mode re-homes cross-user characters to the Orphaned-Characters sentinel (D11) | ✅ merged                                       |
| PR-C preview (#1781) — `RetentionPurgeService` owns the single D3/D4 predicate; read-only `GET /internal/retention/preview` + `pnpm ops retention:preview`                 | ✅ merged                                       |
| **PR-D purge + nag**                                                                                                                                                       | ⏭️ **NEXT — carries a hard blocker**            |

**🚧 PR-D blocker — orphan accessibility (owner-decided, deferred here from PR-B).** After a purge re-homes a **private** character to the sentinel, nobody can see it: `canUserViewPersonality` = `isPublic \|\| ownerId === userId \|\| PersonalityOwner`, all false, and `channel/activate.ts` blocks reactivation. Needs a view-without-edit permission primitive — force-`isPublic` and over-granting via `PersonalityOwner` were both rejected. **Design this before building PR-D.**

**Owner calls locked**: orphan-bucket sentinel + `original_owner_discord_id` · `retention_exempt` column · 10013 immediate-purge-with-guard · single `retention_purge_log` (audit+DLQ) · mode-aware `eraseAccount` · TOCTOU re-check.

**Open follow-ups**: `sendCustomSuccess`→`sendContractSuccess` internal-routes sweep · two fake-optional columns · `retention_purge_log` enum-typing (→ PR-D writer) · empty-preview denominator gap (#1782 era).

**Review lessons worth keeping** (PR-B, 3 rounds): the reviewer caught a **sync-LWW hazard** — I reflexively used raw SQL to skip `@updatedAt` on the re-home, inverting the rule's intent (that pattern is for _non-semantic_ stamps; ownership change is semantic and must win the sync). Fixed to a Prisma write + regression test.

## UX Epic — Phase 3 IN FLIGHT (2026-07-20 → )

Waves 0–2 ✅ released beta.173 · **Wave 3 (breaking renames) ✅ released beta.174** — six PRs, 15 old→new command rows. Per-PR detail: `cold/epic-log.md` § Phase 3.

**NEXT: Waves 4–6** — PR-6a factory core+pilot → 6b destructive preset → 7 `/deny` redesign → 8 picker hygiene → 9/10 factory sweep + router adoption. Ship as normal minors; post-batch class slices are schedulable (burn-down trigger fired). Command-propagation lag ~1h in prod post-release.

Phases 1–2 are ✅ COMPLETE (released beta.170–172); their per-PR narratives live in `cold/epic-log.md` and git history.

## 🔬 Open smoke checklist (owner-driven; this file is the source of truth)

Nothing here is CI-verifiable — each item needs a human in Discord.

| #   | Item                                                                                                                           | Status                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1   | `pnpm ops retention:preview --env dev` — exercises the tooling→gateway chain live                                              | ⬜ un-run              |
| 2   | `pnpm ops retention:preview --env prod` — read-only; first real cohort numbers                                                 | ⬜ owner's call        |
| 3   | `/voice voices purge` again → expect clean "Deleted N" (was 190 spurious 404s)                                                 | ⬜ post-#1752 re-check |
| 4   | Re-upload the MP3 that was rejected as `audio/mpeg3`                                                                           | ⬜ post-#1752 re-check |
| 5   | A **new** character speaks on Mistral (clone-refusal was blocked by a false `truncated` flag)                                  | ⬜ post-#1752 re-check |
| 6   | `/memory fresh` enable → 🌱 footer on a chat turn → status → disable                                                           | ⬜ post-#1753          |
| 7   | `/incognito status` with the character filter                                                                                  | ⬜ post-#1753          |
| 8   | Wave-3 remainder: history purge · `/preset override` + `set-default` · avatar/voice groups · `/random` · `/chime-in` · `/help` | ⬜ partial             |
| 9   | One voice message + one long voice reply                                                                                       | ⬜ open since beta.164 |

Executed so far in the Wave-3 round: `/voice voices purge` (surfaced a real bug → #1752), `/character voice set` (surfaced a second → #1752), `/chat` in an activated thread (works).

## 🔭 Watches

- **Dev-bot Discord quarantine — TERMINAL, not pending.** Rotzot's appeal was **DENIED 2026-07-22** (canned reply; did not engage with the zero-messages-sent / already-fixed facts). The app is permanently unable to join new guilds or DM users it hasn't messaged before. Root cause was boot-time createDM prewarm sweeps (~117 opens × 10+ deploys/day from a 1-server bot — spam-prep shape even with no sends); structurally fixed by `OUTBOUND_DM_ALLOWLIST` (#1650). **Prod Tzurot is a separate app and was never quarantined.** Casualty is dev outbound-DM testing only.
  **Owner leaning: delete & recreate Rotzot as a fresh dev app.** When executed: new app + token → set dev `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` → re-register commands → re-invite to the dev guild → set `PUBLIC_SITE_URL`/`SITE_BRAND=rotzot` → re-run the broadcast smoke with a fresh label.
- The recurring dev-blast `0 sent, 1 transient-failed` **is** this quarantine surfacing as `discord-20026` — runtime-confirmed. Classifier Quick Win open (copy should read "bot quarantined (permanent)").
- First prod extraction log post-beta.165 (`valid_from` should stamp source time, not run time) · first deploy-orphan/safety-flush event (#1642 runtime proof) · owner's felt-repetition re-measure (gates 1b slice B + correction detection) · db-sync probes · prod lock-storm · retention-failure.

## 🧹 Context-trim pass (in flight)

`/doctor` round 1 (#1782) cut derivable content from always-loaded rules: −122 lines, **−857 est. tokens**. Round 2 (#1783) moved `08-review-response.md` (217 lines) to `/tzurot-review-response`: **−5,426 est. tokens**. Rules: 2229 → 1891 lines, ~40.3k → ~34.1k est. tokens.

**Methodological finding worth keeping**: round 1 cut ~28 bytes/line, round 2 ~100. This file was ~400. `pnpm ops lines:check` counts **lines**, so it rated CURRENT.md at 95/97 ("nearly at limit") while it was actually ~9.5k est. tokens — 28% of the whole rules surface in one file. **Line count is the wrong proxy for context cost**; weigh bytes before choosing a trim target.

_Older session logs live in git history._
