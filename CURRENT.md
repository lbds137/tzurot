# Current

> **Version**: v3.0.0-beta.176 (released 2026-07-25) — retention Phase 2 groundwork + CH sync unification. Read-only cohort preview + mode-aware account erasure + flag/schema plumbing, all inert (#1779–#1781) · `conversation_history` became a normal sync table, bespoke tombstones retired (#1778) · `/admin cleanup` option `timeframe`→`days` (#1790) · backlog admission bar + ruled-out exit (#1787) · CI-monitor run-list check (#1791). **Shipped through a maintenance window** — the CH migration carries `DROP TABLE` + a `SET NOT NULL` rewrite, destructive against still-live beta.175 code. Prod schema migrated pre-merge; all DB-touching services redeployed before traffic resumed.

---

## Unreleased on Develop

_(empty — beta.176 just shipped; develop is SHA-aligned with main.)_

## 🔎 The prod cohort is EMPTY, and the reason reshapes PR-D

First `retention:preview --env prod` (2026-07-25, immediately post-deploy — it was gated on this release, which is why the release went ahead of PR-D). It reported no eligible users. The preview has a known denominator gap, so a one-off read-only probe decomposed the predicate rather than trusting the zero:

|                               |  count |
| ----------------------------- | -----: |
| users total                   |    272 |
| `dm_undeliverable_since` set  |  **0** |
| `discord_account_gone_at` set |      0 |
| inactive ≥180d                | **51** |
| both arms (= eligible)        |  **0** |

**The epic's triggering event has evaporated, correctly.** The "26 undeliverable users" from beta.174's blast were unreachable because the BOT was rate-quarantined (`20026`), not because those users were gone. Once the quarantine lifted and beta.175's release DM delivered, D10's blast-success clear wiped every stamp — exactly its design intent.

**What this means for PR-D**: the purge would ship with an empty cohort. Not a reason to skip it (51 users are past the inactivity threshold and become eligible the moment a real DM to them fails), but the "26 users waiting" framing is dead and should not drive urgency or scope.

**And a near-miss worth keeping**: had those stamps persisted, any of the 26 who are also among the 51 inactive would be purge-eligible right now — erased for a failure that was the bot's, not theirs. The overlap is unmeasurable now precisely because the clear worked. D10 was load-bearing, not a nicety.

## 🔬 Smoke checklist — v3.0.0-beta.176 (post-deploy)

_Risk-scoped to what this release actually touches. Everything not listed here is covered by CI + review — don't spend a round on it._

| #   | Item                                                      | Why it's here                                                                                                                                                                                                                                                                                                         | Status     |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **Send a normal message to any character in a channel**   | The migration makes `conversation_history.updated_at` NOT NULL. A write path that misses the column fails the insert — this is the migration's live-path risk and the cheapest possible check.                                                                                                                        | ⬜ not run |
| 2   | **`/admin db-sync`** (dev first, then prod)               | `conversation_history` is now a normal sync table with an AFTER-DELETE trigger; this is the first sync under the new tombstone regime, and 5,695 bespoke tombstones were migrated into `sync_tombstones`. Doubles as another data point on the open silent-db-sync-death issue — the transport probes are still live. | ⬜ not run |
| 3   | **`/settings data delete`** (dev, on a throwaway account) | PR-B reshaped this into `AccountEraserService`. Semantics are preserved by design, but the code path is newly-shaped and rarely exercised — better to find a regression here than to have the purge inherit it.                                                                                                       | ⬜ not run |
| 4   | **`/admin cleanup days:7`**                               | The option was renamed from `timeframe`. Confirms the picker shows `days` and the handler reads it.                                                                                                                                                                                                                   | ⬜ not run |

**Agent-run, all ✅ 2026-07-25**: `retention:preview` on dev (pre-release, plumbing green) and prod (post-deploy, 0 eligible — decomposed above); the URL-escaping sweep the release review flagged as targeted-not-exhaustive (0 unencoded path segments across all 51 changed prod files).

## 🎯 Active epic — Automated Inactivity Retention & Purge

Design ACCEPTED 2026-07-23 (council trio + 6 owner calls) → [`inactivity-retention-purge-phase2.md`](docs/proposals/backlog/inactivity-retention-purge-phase2.md).

| Slice                                                                                                                                                                      | State                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Phase 1 (1a–1d) tracking substrate                                                                                                                                         | ✅ released beta.175; prod backfilled 270 users |
| Phase 1.5 CH sync unification (#1778)                                                                                                                                      | ✅ merged                                       |
| PR-A schema (#1779) — `discord_account_gone_at`, `retention_exempt`, `original_owner_discord_id`, `retention_purge_log`                                                    | ✅ merged                                       |
| PR-B mode-aware erasure (#1780) — `AccountEraserService` unifies DB+off-DB (D1); `retention` mode re-homes cross-user characters to the Orphaned-Characters sentinel (D11) | ✅ merged                                       |
| PR-C preview (#1781) — `RetentionPurgeService` owns the single D3/D4 predicate; read-only `GET /internal/retention/preview` + `pnpm ops retention:preview`                 | ✅ merged                                       |
| **PR-D purge + nag**                                                                                                                                                       | ⏭️ **NEXT — unblocked 2026-07-25**              |

**✅ PR-D blocker RETRACTED (2026-07-25, code-verified).** The "re-homed private characters are unreachable" claim reasoned from `canUserViewPersonality`, which is a route guard — **not** the runtime gate on talking to a character. That gate is `PersonalityLoader.buildAccessFilter` = `{ OR: [{ isPublic: true }, { ownerId }] }`, applied to every message-path load. So a non-owner can never load a private character to talk to it: a private character can't gain cross-user reach going forward, and re-homing never removes access anyone still had (public keeps `isPublic` through the owner change; private had already excluded them). Owner raised it, code confirms it. Residual is the inverse and much smaller: a once-public-now-private character with historical reach is **preserved** and reachable by nobody but the bot owner — over-retention, a predicate tweak decided with PR-D, not gating it. Detail in design D11.

**Also corrected in the same pass**: the privacy-policy entry is a **PR-D gate, not Phase 4**. The published retention table says "Account basics, usage records — Until you delete your account"; the first _manual_ purge falsifies that. Autonomy isn't what makes it untrue — deleting an account the user didn't ask to delete is.

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

_Older session logs live in git history._
