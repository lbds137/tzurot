# Retention Phase 2 — Preview + Unreachable Purge (detailed design)

**Status:** ACCEPTED 2026-07-23 (owner + council trio + owner decisions on 6 open calls). **Extends** [`inactivity-retention-purge.md`](inactivity-retention-purge.md) (the ACCEPTED epic design). The parent's locked decisions (single 180-day window, `50278`/`50007`-only unreachable stamp, manual-approval-first, circuit breaker) carry forward; this doc details, and in three places refines, the Phase 2 phasing bullet. Prerequisite: [`conversation-history-sync-unification.md`](conversation-history-sync-unification.md) (Phase 1.5).

**Owner directive (verbatim, from the epic):** _"I'm not a commercial entity that can retain user data indefinitely for people who haven't touched the bot in over 3 months."_ Data-minimization posture (GDPR Art. 5(1)(e) storage-limitation framing), not a legal mandate.

**Provenance:** two code-archaeology grounding agents + direct reads (2026-07-23); an adversarial council trio (GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max, 2026-07-23 — record at the end); owner decisions on four open calls (2026-07-23). Key files: `services/api-gateway/src/services/AccountDeletionService.ts`, `services/api-gateway/src/routes/user/account/delete.ts`, `packages/tooling/src/retention/backfill-last-active.ts` + `commands/retention.ts`, `services/bot-client/src/services/SecretRotationNagScheduler.ts`, `services/bot-client/src/utils/ownerChannel.ts`, `services/api-gateway/src/services/sync/config/syncTables.ts`, `prisma/schema.prisma`, `prisma/drift-ignore.json`.

---

## What Phase 2 is (and is not)

**Is:** (1) `pnpm ops retention:preview` — a read-only report of the purge-eligible cohort, mutating nothing; (2) the **unreachable** purge branch (`dmUndeliverableSince` set + inactive ≥180d, or a gone-account per D13) behind **manual approval** — the operator drives every deletion; (3) a daily owner-channel **nag** so the accruing cohort is visible without the operator remembering to check; (4) the correctness prerequisites the branch depends on (D10, D11, D12).

**Is not:** the **reachable** branch (notify + `AccountExportJob` offer + grace) → Phase 3. **Autonomous** execution (job purges without operator approval, guarded only by the hard-halt breaker) → Phase 4. The privacy-policy `/privacy` entry lands with the autonomous flip (Phase 4) unless the owner wants the retention claim public the moment purging begins.

---

## The system as-is (verified grounding)

### The purge primitive exists — but "complete erasure" is split across service + route, and encodes SELF-SERVE semantics

`AccountDeletionService.deleteAccount(userId, discordUserId)` is production-tested (the self-serve delete-my-account right). It is the **DB** half: one `$transaction` (`60_000ms`) opening **`SET CONSTRAINTS ALL DEFERRED`** — mandatory, because `users.defaultPersonaId → personas` is `onDelete: Restrict` but `DEFERRABLE INITIALLY IMMEDIATE`; a bare `DELETE FROM users` fails. Three explicit loose-ref sweeps (no-FK tables) run **before** the cascade: `memory_facts` about the user under *other* scopes (case-insensitive `user:<name>` entity-tag sweep), `pending_memories`, `llm_diagnostic_logs` (loose Discord-ID). Then `tx.user.delete()` cascades ~16 subtrees. `SuperuserDeletionError` backstop.

Two facts reshape the reuse:
- **The off-DB half lives in the route, not the service** (`delete.ts`): filesystem **avatar unlink** (avatars are served filesystem-first → skipping leaves them *publicly downloadable*), **Redis** session + provisioning-cache eviction, **`UserCacheInvalidationService` broadcast** (a stale cache entry FK-violates on the next write). `deleteAccount()` **alone is incomplete and insecure.**
- **It deletes owned characters for EVERYONE** (owner-decided for self-serve). For an *automated* purge that is unacceptable — see D11.

### The cascade map (why a purge is a transaction, not a DELETE)

Cascades automatically (16 subtrees incl. **encrypted BYOK keys**, **encrypted shapes.inc cookies**, **export-blob rows**, feedback, configs, conversation_history, memories, facts). The stated 5-item scope in the epic under-describes the real deletion by ~a dozen tables. Only one FK would BLOCK (`defaultPersonaId`, resolved by the deferral). Three no-FK tables would ORPHAN silently — the three sweeps exist for exactly these.

### Sync (dev↔prod, last-write-wins) — the one gap, closed by Phase 1.5

The generalized `sync_tombstones` AFTER-DELETE triggers (which fire on cascades) cover 12 purge-target tables → deletions propagate, no resurrection. **`conversation_history` was excluded** (its bespoke tombstone system, which a DB cascade doesn't invoke) — a real resurrection gap for any cascade-delete (the account purge *and* today's self-serve `/settings data delete`). **Phase 1.5** ([`conversation-history-sync-unification.md`](conversation-history-sync-unification.md)) closes it by making CH a normal sync table; see D8.

### Selection signals + reporting infra

`lastActiveAt` (NULL → fall back to `createdAt`), `dmUndeliverableSince` (per-user 50278/50007, cleared on activity), `is_superuser` (auto from `BOT_OWNER_ID`). Daily-job template: `SecretRotationNagScheduler` (daily + startup, restart-friendly, Redis weekly cooldown, posts via `postOwnerChannelEmbed`). **bot-client has no Prisma** → the nag reads the cohort count from a gateway endpoint; the **ops CLI can't import api-gateway services** → the purge orchestration lives behind the gateway.

---

## Decisions (council-hardened + owner-decided)

**D1 — One mode-aware `eraseAccount()` (DB + off-DB), shared by the delete route and the purge.** Extract the route's off-DB cleanup (avatar unlink, Redis eviction, cache broadcast) alongside the DB transaction into a single primitive with a **mode**: `self-serve` (delete owned characters for everyone, unchanged) vs `retention` (re-home cross-user characters per D11, never touch other users' data). _Council (GLM/Kimi): reusing `deleteAccount()` unmodified would make the first purge wipe other users' data — the mode param is the fix._

**D2 — Gateway `RetentionPurgeService`; the purge endpoint is PER-USER; the CLI drives a resumable sequential loop.** Expose `GET /internal/retention/preview` (read-only cohort summary) + `POST /internal/retention/purge` operating on **one user per call**. The CLI loops the cohort, calling per-user, tracking progress locally to resume after interruption; each call is **idempotent** (200 if the user is already gone). _Council (Qwen): a per-batch POST would blow Railway's ~60s HTTP timeout mid-run and leave a partial, unrecorded purge — a per-user 60s tx fits; a batch of 26 does not._

**D3 — Single-source the eligibility predicate.** One `selectPurgeCohort()` in `RetentionPurgeService`, consumed by preview, nag, and purge — the nag's count and the purge's target can never drift.

**D4 — Selection predicate + TOCTOU re-check.**
```sql
SELECT id, discord_id FROM users u
WHERE (u.dm_undeliverable_since IS NOT NULL OR u.discord_account_gone_at IS NOT NULL)  -- unreachable/gone (D13)
  AND COALESCE(u.last_active_at, u.created_at) < now() - interval '180 days'            -- inactive (NULL→createdAt)
  AND u.is_superuser = false                                                            -- exempt bot owner (mandatory)
  AND u.retention_exempt = false                                                        -- exempt list (D12)
```
The cohort is selected at preview time but purged later; **the per-user deletion transaction re-evaluates this predicate and aborts that user if it no longer holds** (a user who became active between preview and purge cleared the flag / bumped `last_active_at`). _Council (all three): TOCTOU race — without the re-check, a now-active user gets erased._ Users <180d old with NULL `last_active_at` fall back to `created_at` → correctly excluded.

**D5 — CLI ergonomics + safeguards.** `retention:preview` read-only, no prod-confirm. `retention:purge` uses `confirmProductionOperation` as the manual-approval gate; `--dry-run` == preview; `--exclude <ids>` for per-run skips; `--force` bypasses the *prompt* but **not** the hard-ceiling breaker (D-circuit). _Council (Kimi/GLM): `--force` must not be able to wipe the cohort with a single flag._

**D6 — The Phase-2 daily job is a NAG.** Mirror `SecretRotationNagScheduler`: daily + startup, Redis weekly cooldown, calls `GET /internal/retention/preview`, posts an owner-channel embed ("N eligible — review `retention:preview`, execute `retention:purge`"). It **reports; it does not delete.** Autonomous execution is Phase 4. Nag is read-only; it includes the exact CLI command.

**D7 — `isLocked` "core memories" ARE deleted.** A full account erasure ignores `isLocked` (which only guards batch/memory-purge paths). Correct for a departed user — erasure is complete or it isn't.

**D8 — CH sync-safety is handled by Phase 1.5, not by special-casing the purge.** Phase 1.5 (the conversation-history sync unification — [`conversation-history-sync-unification.md`](conversation-history-sync-unification.md)) makes `conversation_history` a normal sync table (adds `updatedAt` + the generalized AFTER-DELETE trigger, retires the bespoke tombstone). After it lands, an account-purge's CH cascade-delete auto-tombstones like `memories`/`memory_facts` — **the purge needs zero CH-specific handling.** _Supersedes the earlier "write explicit CH tombstones in `eraseAccount()`" — the root-cause fix is cleaner than working around the gap per-caller; a sub-council (i/ii/iii → iii) + an audit of all five CH update sites confirmed it's safe (no non-semantic `updatedAt`-bumping write exists)._ The Phase-1.5 round-trip test proves the cascade no longer resurrects.

**D9 — Post-purge `VACUUM` is a routine, non-blocking step; never inline a blocking rebuild.** Run plain `VACUUM` (not `VACUUM FULL`) on the vector tables after a purge. `VACUUM FULL`/`REINDEX` take `ACCESS EXCLUSIVE` locks → block ai-worker embedding queries → bot outage. If IVFFlat recall degrades after a large purge, `REINDEX ... CONCURRENTLY` in a maintenance window — never inline with the purge. _Council (Qwen/GLM): the naive "VACUUM the vector tables" was an outage foot-gun._

**D10 — Fold in the blast-success clear (correctness prerequisite).** Clear `dm_undeliverable_since` on the `sent` transition in `handleReleaseBroadcastDeliveries` (batched over the sent set) — a rejoined-reachable-but-never-interacted user keeps a stale flag and would route to the unreachable (purge-without-notice) branch. **Note:** clear-on-*inbound*-activity is already shipped (Phase 1's `getOrCreateUser` stamp); D10 adds only the *send-success* side. (Persona-DM send-success clear rides the deferred persona-DM-stamp follow-up — out of scope here.)

**D11 — Orphaned-character reassignment (OC1, owner-directed).** In `retention` mode, for each owned personality with **cross-user reach** (other users have `conversation_history`, `memories`, OR `facts` scoped to it — broadened from the memories-only `fetchOtherUserReach` per council), the erase does **not** cascade-delete it. Before `tx.user.delete()`:
- Re-point `personality.ownerId` → a dedicated **"Orphaned Characters" sentinel user** — a single reserved User row (`is_superuser = false`, `retention_exempt = true`, a reserved system identity), explicitly **not** the operator's superuser account (owner: _"I don't want them treated as my characters because I didn't make them… a separate global ownership bucket not tied to any user but controllable by me."_).
- Stamp a new nullable `personalities.original_owner_discord_id` with the purged user's Discord ID — provenance for **reclamation** (if the original owner returns, ownership can be handed back; the reclamation *flow* is Phase 3+, but Phase 2 must capture the ID).

Owned personalities with **no** cross-user reach cascade-delete normally (nobody else uses them — minimize). The operator manages orphaned characters via existing superuser admin powers (the sentinel is a holder, not an admin). _Owner refinement of GLM's reassign-to-superuser: a distinct orphan bucket, not the operator's own account._ **Build-time grounding required:** verify how ownership-based UI/permission checks (autocomplete, "is this mine?", listing) treat a sentinel-owned character — orphans must stay usable so other users' history keeps working. Sentinel seeded via a bootstrap (mirror `TtsConfigBootstrap`).

_Deferred to Phase 3 (owner):_ since the sentinel is not a real Discord account the operator can log into, admin **management commands** for it (list orphaned characters, reassign, reclaim-to-original-owner via `original_owner_discord_id`) land with the Phase-3 reclamation flow — not Phase 2. Phase 2 only re-homes characters and captures the provenance ID; the operator can still manage them through existing superuser admin surfaces in the interim.

**D12 — Add `users.retention_exempt` boolean (OC5, owner-decided).** Additive migration (the only schema change Phase 2 *requires* beyond D11's `original_owner_discord_id` and D13's gone-column). The predicate gates on it; the orphan-bucket sentinel is `retention_exempt = true`. _Owner has an account to protect durably — the per-run `--exclude` (D5) stays as a convenience, but the exemption survives across runs in the column._

**D13 — Stamp Discord `10013` (deleted account) now; immediate-purge with a persistence guard (OC3, owner-decided).** Add a **distinct** `users.discord_account_gone_at DateTime?` (NOT `dmUndeliverableSince` — Phase 1 deliberately scoped that to 50278/50007; a gone account is a stronger, differently-handled signal). Stamp it in the same delivery handler PR-A touches. **Verification (owner-requested):** 10013 is a resource-not-found code (`100xx` "Unknown X" family), not a transient/rate-limit/5xx code — for a previously-valid user it means the account no longer resolves. Not *provably* never-transient (a Discord outage could theoretically 404 a live user), so the purge fast-tracks a gone account past the 180-day wait **only if the flag persists to the next daily run** (a real deletion persists; a freak transient self-corrects via the activity clear) — and always behind operator approval. _Council split (GLM defer / Kimi immediate / Qwen instrument-now); owner: stamp now + immediate-purge-with-guard._

**D14 — A `retention_purge_log` audit table, added in Phase 2 (owner: add now, not deferred).** Every purge writes a row: the target's `id` + `discord_id`, `purged_at`, the operator/run context, the per-table deletion counts (from the `AccountDeletionSummary`), the DB outcome, and an **off-DB reconciliation status** (`pending` / `done` / `failed`). This one table is BOTH the immutable audit trail (diagnosing a "my data disappeared" ticket, demonstrating the retention policy is enforced) AND the off-DB retry queue (D15). _Owner reversed the Phase-2 scope-down ("why not add them now if we're adding them later anyway"); and consolidated the council's two-table proposal (a `retention_purge_log` audit table + a `failed_off_db_purges` DLQ) into ONE table — the audit row's reconciliation-status field is the DLQ, which is more correct than deferring and simpler than two tables._

**D15 — Off-DB partial-failure via the audit table's reconciliation status.** The off-DB steps (avatar/Redis/cache) are idempotent and re-runnable; a failure after the DB commit sets the row's `off_db_reconciled = false` (logged, not swallowed, not fatal to the request). A reconciliation sweep (`retention:reconcile-off-db`, or folded into the next purge run) retries `off_db_reconciled = false` rows. Ordering: run off-DB **before** the DB delete where safe — a DB-tx failure then orphans harmless off-DB cleanup, vs. the reverse leaving a public avatar with no row to retry from. _The single D14 audit table's status field serves the council's DLQ purpose; no separate `failed_off_db_purges` table._

---

## Circuit breaker (Phase 2 form)

A **warning annotation** on the preview/nag report, not a hard halt: flag when the cohort exceeds **~15% of the userbase** OR a bounded absolute count (the operator sees the batch and decides). A **hard-ceiling override** at **~25%** that even `--force` cannot bypass without an explicit `--breaker-override` flag (guards a scripted run against a `lastActiveAt`-glitch mass-flag). The known first batch (~26/270 ≈ 10%) sits under the warning line as intended — it's the backfilled zombie cohort, not a glitch. The hard-*halt*-and-page form belongs in Phase 4 (autonomous, no human reviews first). _Report includes absolute count + percentage (GLM)._

## Verified NOT applicable (council misses against this architecture)

- **External credential revocation** (Qwen): we *store* user-provided BYOK keys / shapes.inc cookies — we're not the issuer, so deleting our copy is complete; there is nothing to revoke externally.
- **Zombie-cache in-flight race** (Qwen): near-zero for this cohort by definition — purge targets *inactive* users with no in-flight requests. Defensive note only; no design change.
- **Clear-flag-on-any-inbound-activity** (all three): already shipped in Phase 1 (the `getOrCreateUser` activity clear). Only the send-success side is new (D10).

---

## Phasing / PR sketch

0. **Phase 1.5 (prerequisite, separate slice) — CH sync unification** ([`conversation-history-sync-unification.md`](conversation-history-sync-unification.md)). Makes `conversation_history` a normal sync table so cascade-deletes are sync-safe; must land before PR-D. Independently valuable — also closes the resurrection gap in today's self-serve account delete.

1. **PR A — flag plumbing + schema.** The blast-success clear (D10) + `discord_account_gone_at` stamping (D13) — both touch `handleReleaseBroadcastDeliveries`; ship together. Carries the whole Phase-2 additive migration: `users.discord_account_gone_at` + `users.retention_exempt` (D12/D13), `personalities.original_owner_discord_id` (D11), and the `retention_purge_log` table (D14). All additive → premigrate-safe. Correctness prerequisites; no deletion.
2. **PR B — mode-aware `eraseAccount()` extraction (D1) + orphan-bucket sentinel (D11) + explicit CH tombstones (D8).** Enabling refactor; the self-serve route keeps working (regression-tested), `retention` mode + the orphan reassignment are new but unexercised until PR D. Sentinel bootstrap.
3. **PR C — `RetentionPurgeService` + preview endpoint + `retention:preview` CLI (D2/D3/D4).** Read-only cohort selection + report (with the cross-user-reach and warning annotations). Exercisable against prod at zero risk — the 26 become the first real preview batch.
4. **PR D — purge endpoint (per-user) + `retention:purge` CLI (resumable loop, D2/D5) + the daily nag (D6) + circuit-breaker warning + TOCTOU re-check (D4) + audit-log writes + off-DB failure handling (D14/D15).** The first destructive capability, operator-driven, prod-confirm-gated, `--breaker-override`-ceilinged. Includes the sync round-trip test proving D8.

The split isolates the enabling refactor (B) from the new capability (D) and keeps every destructive step behind a green preview (C).

---

## Council record (trio, 2026-07-23 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

**Adopted (convergent, folded above):** mode-aware `eraseAccount()` (GLM D1 · Kimi D1 → D1/D11); TOCTOU per-user re-check (all three → D4); cross-user guard broadened to conversation_history + facts (Kimi → D11); explicit CH tombstones over transitive reliance (Kimi/Qwen → D8); per-user endpoint + resumable idempotent CLI loop, not a per-batch POST (Qwen HTTP-timeout → D2); `--force` hard-ceiling override (Kimi/GLM → D5/breaker); non-blocking `VACUUM`, no inline `REINDEX` (Qwen/GLM → D9); off-DB partial-failure handling + ordering (GLM/Qwen → D15); absolute-count in the breaker report (GLM). **OC2 (gateway home) and OC6 (nag+CLI) unanimous-confirmed. OC4 (warning in P2, hard-halt in P4) unanimous.**

**Owner-decided splits:** OC1 → orphan-bucket reassignment (owner refined GLM's reassign / Kimi+Qwen's exclude into a distinct non-superuser orphan bucket + reclamation ID — D11); OC3 → stamp 10013 now + immediate-purge-with-persistence-guard (Kimi/Qwen instrument-now over GLM defer; owner added the guard — D13); OC5 → `retention_exempt` column (GLM add-now over Kimi/Qwen defer; owner has an account to protect — D12).

**Owner reversed a scope-down:** the council's `retention_purge_log` audit table + `failed_off_db_purges` DLQ are added in Phase 2 (not deferred to Phase 4), consolidated into a single audit table whose reconciliation-status field is the DLQ (D14/D15) — "add them now if we're adding them later anyway."

**Still scoped down:** endpoint mTLS/network-isolation → existing service-auth + operator-identity in the audit log (the `/internal/*` routes are already service-auth-gated and not publicly routed).

**Declined as N/A (verified):** external credential revocation; zombie-cache race; clear-on-any-inbound (already shipped). See "Verified NOT applicable."

## Backlog absorption (at landing — pending owner acceptance)

- Parent artifact: strike the Phase 2 `10013` open call → dispositioned here (D13).
- `cold/follow-ups.md`: blast-success clear → D10/PR-A; persona-DM stamp → confirmed-deferred (referenced in D10/D13); `beginEnvScopedOp` preamble-extraction → the new CLI commands are candidates when it runs.
- `active-epic.md` Phase 2 row + `backlog/now.md` + `CURRENT.md` → update on acceptance.
- `guard:proposal-links`: this file needs an inbound link (parent artifact + active-epic) at landing.
