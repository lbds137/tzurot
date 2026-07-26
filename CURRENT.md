# Current

> **Version**: v3.0.0-beta.176 (released 2026-07-25) — retention Phase 2 groundwork + CH sync unification. Read-only cohort preview + mode-aware account erasure + flag/schema plumbing, all inert (#1779–#1781) · `conversation_history` became a normal sync table, bespoke tombstones retired (#1778) · `/admin cleanup` option `timeframe`→`days` (#1790) · backlog admission bar + ruled-out exit (#1787) · CI-monitor run-list check (#1791). **Shipped through a maintenance window** — the CH migration carries `DROP TABLE` + a `SET NOT NULL` rewrite, destructive against still-live beta.175 code. Prod schema migrated pre-merge; all DB-touching services redeployed before traffic resumed.

---

## Unreleased on Develop

- **#1793** dead-`getPrismaClient` doc sweep · **#1794** council roster → Kimi K3 · **#1795** retention **PR-D1 — the purge capability** (6 review rounds; dev migration applied) · **#1796** `/history purge` now retires the memories derived from the purged turns (prod bug; mutation gate caught a 52%→97% test gap in the extracted module) · 18 epic-scoped follow-up rows relocated into their theme files (pool 360 → 341).

## ⏭️ NEXT SESSION STARTS HERE

**1. Dev end-to-end purge smoke** — open-checklist item 10. Everything in #1795 is proven against PGLite only; **no real purge has ever executed**, and nothing has exercised the real cascade + Redis + filesystem together. Do this before PR-D2.

**2. Retention PR-D2** — the daily owner-channel nag (mirror `SecretRotationNagScheduler`: daily + startup, Redis weekly cooldown, silent at 0 eligible, embed carries the breaker warning + the exact CLI command). Reads the preview endpoint that already exists; fully independent of D1.

**3. Then the backlog substrate** → **[`docs/proposals/backlog/backlog-substrate.md`](docs/proposals/backlog/backlog-substrate.md)**. Owner call 2026-07-25: _"I definitely want us to structurally fix our backlog problem because it's not gonna get any better unless we do something about it. and it's a very foundational thing."_ Read it before anything else — two council passes, corrections, and the owner's design constraint all live there:

- **The whim constraint (outranks everything):** the owner's priority-jumping is partly the POINT — an outlet from a stressful life. Every council model treated it as a defect to correct; all such mechanisms are disqualified. **Target inverts: don't make jumping harder, make the haystack cheap to jump around in.** Acceptance test is the owner's own: not "a nicer store for 341 items" but **"here are the 20 items you could close this week."**
- Two numbers I previously published are **WITHDRAWN**: "118 stranded rows" (real: ~24) and "filing outpaces drain 2:1" (real: drain capacity is 2–4× filing — the pool grows only because nothing links PR throughput to drain).
- Leading candidate **Backlog.md** cleared every pre-set kill criterion; not yet trialled. **Migrate nothing before a bounded trial.**
- Unanimous: **the system-model gap outranks the substrate** → [`cold/themes/system-model-and-intent-linkage.md`](backlog/cold/themes/system-model-and-intent-linkage.md) (its Phase 0 was rewritten after council rejected the generate-from-mechanical-sources plan).
- Still open: the three held unanimous items · whether/at-what-dose to trial Backlog.md · sequencing slot for system-model.

## 🔬 Smoke checklist — v3.0.0-beta.176 (post-deploy)

_Risk-scoped to what this release actually touches. Everything not listed here is covered by CI + review — don't spend a round on it._

| #   | Item                                                      | Why it's here                                                                                                                                                                                                   | Status                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Send a normal message to any character in a channel**   | The migration makes `conversation_history.updated_at` NOT NULL — a write path missing the column fails the insert.                                                                                              | ✅ **PASS** (owner, prod) — verified in data: 30 rows written in the following 3h, **0 with NULL `updated_at`**. Tombstone carry-over also confirmed: 5,694 CH rows in `sync_tombstones` with original `deleted_at` preserved. |
| 2   | **`/admin db-sync`** (dev first, then prod)               | First sync under the new tombstone regime. Doubles as a data point on the open silent-death issue — transport probes still live.                                                                                | ✅ **PASS** (owner, prod) — reply landed. First prod sync under the unified CH tombstone regime, so it also verifies Phase 1.5 live. Recorded as clean prod run #2 on the open silent-death issue; probes stay.                |
| 3   | **`/settings data delete`** (dev, on a throwaway account) | PR-B reshaped this into `AccountEraserService`. Semantics are preserved by design, but the code path is newly-shaped and rarely exercised — better to find a regression here than to have the purge inherit it. | ⬜ not run                                                                                                                                                                                                                     |
| 4   | **`/admin cleanup days:7`**                               | The option was renamed from `timeframe`. Confirms the picker shows `days` and the handler reads it.                                                                                                             | ⬜ not run                                                                                                                                                                                                                     |

**Agent-run, all ✅ 2026-07-25**: `retention:preview` on dev (pre-release, plumbing green) and prod (post-deploy, 0 eligible — decomposed above); the URL-escaping sweep the release review flagged as targeted-not-exhaustive (0 unencoded path segments across all 51 changed prod files).

## 🎯 Active epic — Automated Inactivity Retention & Purge

Design ACCEPTED 2026-07-23 (council trio + 6 owner calls) → [`inactivity-retention-purge-phase2.md`](docs/proposals/backlog/inactivity-retention-purge-phase2.md).

| Slice                                                                                                                                                                                                                        | State                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Phase 1 (1a–1d) tracking substrate                                                                                                                                                                                           | ✅ released beta.175; prod backfilled 270 users |
| Phase 1.5 CH sync unification (#1778)                                                                                                                                                                                        | ✅ merged                                       |
| PR-A schema (#1779) — `discord_account_gone_at`, `retention_exempt`, `original_owner_discord_id`, `retention_purge_log`                                                                                                      | ✅ merged                                       |
| PR-B mode-aware erasure (#1780) — `AccountEraserService` unifies DB+off-DB (D1); `retention` mode re-homes cross-user characters to the Orphaned-Characters sentinel (D11)                                                   | ✅ merged                                       |
| PR-C preview (#1781) — `RetentionPurgeService` owns the single D3/D4 predicate; read-only `GET /internal/retention/preview` + `pnpm ops retention:preview`                                                                   | ✅ merged                                       |
| **PR-D1 purge capability** (#1795) — per-user `POST /internal/retention/purge` + `retention:purge`/`reconcile-off-db` CLI, in-tx TOCTOU re-check, audit ledger, 25% server-side ceiling, gone-flag self-heal, privacy policy | ✅ merged 2026-07-26; dev migrated              |
| **PR-D2 daily nag**                                                                                                                                                                                                          | ⏭️ **NEXT** (D1 smoke first)                    |

**Owner calls locked (D1)**: no 10013 fast-track (gone is an alternative unreachable signal, still ANDed with the 180d window — D13's safety argument assumed an activity-clear that didn't exist; it ships now) · the release-cadence coupling is accepted as Phase 2's scope boundary (the 51 inactive-but-reachable are Phase 3's cohort) · public-then-private characters with historical reach stay retained, because deleting them deletes other users' memories. Earlier locks: orphan sentinel + `original_owner_discord_id` · `retention_exempt` · single `retention_purge_log` · mode-aware `eraseAccount`.

**D15 refined, not followed**: off-DB-before-DB is not implementable (the off-DB work is a function of the transaction's outcome), so DB-first stands and the ledger's `pending` + `off_db_pending` is the retry handle. Recorded in the design doc.

**Open follow-ups**: `sendCustomSuccess`→`sendContractSuccess` internal-routes sweep (deliberately not ridden on the destructive PR) · two fake-optional columns · the purge-concurrency assumption (two members, both gated on Phase 4) · unbounded off-DB reconcile sweep.

**Review lessons worth keeping** (PR-B, 3 rounds): the reviewer caught a **sync-LWW hazard** — I reflexively used raw SQL to skip `@updatedAt` on the re-home, inverting the rule's intent (that pattern is for _non-semantic_ stamps; ownership change is semantic and must win the sync). Fixed to a Prisma write + regression test.

## UX Epic — Phase 3 IN FLIGHT (2026-07-20 → )

Waves 0–2 ✅ released beta.173 · **Wave 3 (breaking renames) ✅ released beta.174** — six PRs, 15 old→new command rows. Per-PR detail: `cold/epic-log.md` § Phase 3.

**NEXT: Waves 4–6** — PR-6a factory core+pilot → 6b destructive preset → 7 `/deny` redesign → 8 picker hygiene → 9/10 factory sweep + router adoption. Ship as normal minors; post-batch class slices are schedulable (burn-down trigger fired). Command-propagation lag ~1h in prod post-release.

Phases 1–2 are ✅ COMPLETE (released beta.170–172); their per-PR narratives live in `cold/epic-log.md` and git history.

## 🔬 Open smoke checklist (owner-driven; this file is the source of truth)

Nothing here is CI-verifiable — each item needs a human in Discord.

| #   | Item                                                                                                                                                                                                                                                           | Status                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 3   | `/voice voices purge` again → expect clean "Deleted N" (was 190 spurious 404s)                                                                                                                                                                                 | ⬜ post-#1752 re-check            |
| 4   | Re-upload the MP3 that was rejected as `audio/mpeg3`                                                                                                                                                                                                           | ⬜ post-#1752 re-check            |
| 5   | A **new** character speaks on Mistral (clone-refusal was blocked by a false `truncated` flag)                                                                                                                                                                  | ⬜ post-#1752 re-check            |
| 6   | `/memory fresh` enable → 🌱 footer on a chat turn → status → disable                                                                                                                                                                                           | ⬜ post-#1753                     |
| 7   | `/incognito status` with the character filter                                                                                                                                                                                                                  | ⬜ post-#1753                     |
| 8   | Wave-3 remainder: history purge · `/preset override` + `set-default` · avatar/voice groups · `/random` · `/chime-in` · `/help`                                                                                                                                 | ⬜ partial                        |
| 9   | One voice message + one long voice reply                                                                                                                                                                                                                       | ⬜ open since beta.164            |
| 10  | **Dev end-to-end purge** (#1795): stamp a throwaway dev user unreachable+inactive → `retention:preview --env dev` shows exactly 1 → `retention:purge --env dev` → user gone, `retention_purge_log` row reads `success`/`done`, re-homed character still usable | ⬜ **no real purge has ever run** |

Executed in the Wave-3 round: `/voice voices purge` + `/character voice set` (each surfaced a real bug → #1752), `/chat` in an activated thread (works).

## 🔭 Watches

- **Dev-bot Discord quarantine — TERMINAL, not pending.** Rotzot's appeal was **DENIED 2026-07-22** (canned reply; did not engage with the zero-messages-sent / already-fixed facts). The app is permanently unable to join new guilds or DM users it hasn't messaged before. Root cause was boot-time createDM prewarm sweeps (~117 opens × 10+ deploys/day from a 1-server bot — spam-prep shape even with no sends); structurally fixed by `OUTBOUND_DM_ALLOWLIST` (#1650). **Prod Tzurot is a separate app and was never quarantined.** Casualty is dev outbound-DM testing only.
  **Owner leaning: delete & recreate Rotzot as a fresh dev app.** When executed: new app + token → set dev `DISCORD_TOKEN`/`DISCORD_CLIENT_ID` → re-register commands → re-invite to the dev guild → set `PUBLIC_SITE_URL`/`SITE_BRAND=rotzot` → re-run the broadcast smoke with a fresh label. The recurring dev-blast `0 sent, 1 transient-failed` **is** this quarantine surfacing as `discord-20026` (runtime-confirmed); classifier Quick Win open (copy should read "bot quarantined (permanent)").
- First prod extraction log post-beta.165 (`valid_from` should stamp source time, not run time) · first deploy-orphan/safety-flush event (#1642 runtime proof) · owner's felt-repetition re-measure (gates 1b slice B + correction detection) · db-sync probes · prod lock-storm · retention-failure.

_Older session logs live in git history._
