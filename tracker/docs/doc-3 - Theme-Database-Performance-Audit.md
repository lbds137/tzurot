---
id: doc-3
title: 'Theme: Database Performance Audit'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Database Performance Audit

_Focus: systematically find and prevent index/query performance debt before scale exposes it (triggered by the message_metadata GIN stall that timed out a user-message persist in prod)._

## Why this exists

The `conversation_history.message_metadata` GIN index was added **speculatively** ("for efficient JSONB queries (e.g., finding all messages with references)") in the column's original migration — a query that was never built. Its pending-list flushes stalled inserts multi-second under load, tripping pg's 6s `query_timeout` and dead-ending a user response (fixed: #1410 resilience, #1411 dropped the index). The worry: **what else like this is lurking that will bite at scale?**

A one-shot prod audit (`pg_stat_user_indexes` / `pg_stat_user_tables`, 2026-06-30) gave real signal **and** showed the analysis needs judgment, not a mechanical drop-the-zeros.

## Findings from the 2026-06-30 prod snapshot

**The nuance that matters for scaling:** an index showing `idx_scan = 0` is NOT automatically droppable. Three distinct cases surfaced:

1. **No query at all** → safe to drop regardless of scale. (`message_metadata` GIN — done.)
2. **A real query exists, but the table is too small for the planner to use the index** → unused _now_, but the planner WILL switch to it as the table grows. **KEEP.** Example: `llm_diagnostic_logs_response_message_ids_idx` (GIN, backs a real `{ has: messageId }` query in `admin/diagnostic.ts`) shows 0 scans because `llm_diagnostic_logs` is only ~223 rows — Postgres seq-scans it. Dropping it would hurt once the table grows. **This is the trap to avoid: don't drop an index that backs a real query just because it's idle at current small scale.**
3. **PK / unique constraint with 0 scans** → these are _constraints_, not query-optimizations; 0 scans just means the table is write-mostly (logs). **Never drop.** (`usage_logs_pkey`, `llm_diagnostic_logs_pkey`, etc.)

**Actionable "no query" candidates** (each still needs the per-index code check `message_metadata` got — is there ANY query, raw or Prisma, that filters/sorts on this column?):
- `conversation_history_discord_message_id_idx` (1656 kB) — btree on the `discordMessageId` String[]; comment says "for deduplication" — verify a dedup query actually uses it.
- `memories_*` secondaries (guild_id, visibility, legacy_shapes_user_id, source_system, session_id, is_summarized) — several 0-scan on a real table; verify each.
- `usage_logs_*` secondaries — verify against billing/reporting queries before assuming unused.

**Other signal:**
- `pg_stat_statements` is **NOT enabled** on Railway prod (`relation does not exist`) — so slow-query ranking is unavailable. Enabling it is prerequisite for the slow-query axis.
- Seq-scan-heavy tables are mostly _tiny_ (`personas` 271 rows, `llm_configs` 34, `personalities` 178) — Postgres correctly prefers seq scans there; NOT a problem. Only `conversation_history` (~7500 rows, 34K seq-scans) is mildly worth a look for a missing index.
- `pg_stat_database.stats_reset` was null; table-level counters are large (522K idx-scans on `users`), so the window is long enough to trust for secondary-index judgments — but confirm stats age before any drop.

### Phase 1 — Prevention (cheapest, highest leverage) — ✅ SHIPPED 2026-07-06
- [x] Rule added to `.claude/rules/03-database.md` § "Indexes Ship With Their Query": new index requires its query in the same PR (grep-verifiable); corollary encodes the 3-case drop judgment (no-query / real-query-small-table-KEEP / PK-constraint-never).

### Phase 2 — Recurring audit tooling
- [ ] `pnpm ops db:index-audit` — pull `pg_stat_user_indexes` (idx_scan, size) + flag 0-scan _secondary_ indexes (exclude PK/unique), classified by the 3 cases above. Recurring green/red signal instead of a one-off. (Audit-class tool — see `docs/reference/audit-enforcement.md`.)

### Phase 3 — Per-index remediation
- [ ] Walk the "no query" candidate list; for each, grep for any query (raw/Prisma) on the column. Drop only true case-1 indexes (no query). Explicitly KEEP case-2 (query exists, table small — needed at scale).

### Phase 4 — Slow-query visibility
- [ ] Enable `pg_stat_statements` on Railway prod (Postgres config / Railway setting), then re-run the slow-query ranking to find the next `query_timeout` waiting to happen.

## Members added 2026-09-04 (TASK-888 pass)

Four missing-index / unindexed-scan rows absorbed from the tracker pool. They belong here rather than in individual slots because **Phase 2 (`ops db:index-audit`) is the mechanism that would surface all four at once**, which no per-row query does — and because this theme's focus line already names exactly their shape: _"systematically find and prevent index/query performance debt before scale exposes it."_ Phase 3's three-case drop judgment is the framework each one is remediated under.

**`03-database.md` § "Indexes Ship With Their Query" governs all four.** Each of these indexes must land in the same PR as the query it backs — the rule the `message_metadata` GIN incident wrote — which is another reason they belong to one pass rather than four opportunistic ride-alongs.

- **TASK-280 — Expression index for the case-insensitive `entity_tags` sweep** (filed 2026-07, was state:observable size:S). Account deletion's fact sweep (`DELETE FROM memory_facts f WHERE EXISTS (SELECT 1 FROM unnest(f.entity_tags) t(tag) WHERE lower(t.tag) = ANY($1::text[]))`) seq-scans `memory_facts`. Fix shape: a GIN expression index over lowered tags — via an immutable helper, or by normalizing tags to lowercase at write time and using a plain GIN with `@>`. Trigger/cost: owner-accepted at current scale; deletion is rare, so a write-path tax on every fact insert needs scale evidence first. Promote when `memory_facts` exceeds ~100k rows, or sweep slowness shows in the deletion-duration logs. Evidence 2026-09-04: `grep -n '@@index(\[entityTags\]' prisma/schema.prisma` → a plain `@@index([entityTags], type: Gin)` exists for `@>` containment lookups elsewhere, but **it cannot serve the `unnest()` + `lower()` per-element comparison**; `sed -n '160,175p' services/api-gateway/src/services/AccountDeletionService.ts` → query unchanged.
- **TASK-289 — Partial index for the broadcast eligibility scan** (filed 2026-07, was state:observable size:S). `resolveEligibleRecipients` filters `notifyEnabled` + `notifyOptedInAt` + `notifyLevel` on `users` with no backing index — a full-table scan, once per release. Fix shape: a partial index (e.g. on `notify_level WHERE notify_enabled AND notify_opted_in_at IS NOT NULL`), landing WITH its query. Same disposition for the retention job's daily `release_delivery_log` sweep, which filters `createdAt` + `status` while only `[releaseId, userId]` and `[userId]` indexes exist. Trigger/cost: correct-as-is at ~hundreds of rows — an index would tax every user-row write for a query that runs a few times a month. Promote when the users table exceeds ~50k rows, the delivery log ~100k, or broadcast-enqueue latency becomes visible in logs. **Ride-along recorded at filing**: the resweep wedge heuristic shares the scale trigger — a genuinely slow >30min blast would be re-enqueued hourly until drained (harmless, pre-filtered, but wasteful); revisit the threshold or add an in-flight check alongside the index work. Evidence 2026-09-04: `grep -n "@@index" prisma/schema.prisma | grep -i notify` → no hits; `sed -n '1316,1348p' prisma/schema.prisma` → `ReleaseDeliveryLog` carries only `@@unique([releaseId,userId])` and `@@index([userId])`.
- **TASK-340 — Bound the fact-cascade join: id-scoped calls + a GIN index** (filed 2026-07, was state:observable size:M). `propagateDeletionToFacts` (`packages/conversation-history/src/memoryDeletionPropagation.ts`) joins ALL `visibility='deleted'` memories against all normal facts, inline in the request path of every `/memory delete`, batch delete, purge, and history-purge propagation. **Deleted memories are never hard-purged, so the join's left side grows monotonically** — per-request cost creeps upward with corpus age rather than staying bounded by what the call changed. Fix shape: a GIN index on `memory_facts.source_memory_ids` (landing WITH its query) plus id-scoped cascade call sites that pass the just-deleted memory ids, keeping the global-join form for a periodic or migration-time self-heal only. Trigger/cost: the global join was chosen deliberately for self-healing and zero id-plumbing at current scale, and is documented in the docstring — this row is that docstring's own escalation. Promote when fact volume makes deletes measurably slow (p95 on delete routes) or `memory_facts` crosses ~100k rows. Evidence 2026-09-04: `sed -n '95,125p' packages/conversation-history/src/memoryDeletionPropagation.ts` → docstring still reads "Both sides of the join are unindexed array scans"; `grep -n "source_memory_ids" prisma/schema.prisma` → field declared, no index.
- **TASK-679 — Roster-blurb sweep runs two unindexed scans over `personalities`** (filed 2026-08, was state:observable size:S). `rosterBlurbSweep` runs on a cron forever, and both its queries are unindexed: the stamping pass filters `card_source_hash IS NULL`, and `findStale` compares `roster_blurb_source_hash IS DISTINCT FROM card_source_hash` — a two-column comparison no ordinary index can serve. Fix shape: a partial index on `(card_source_hash) WHERE card_source_hash IS NULL` serves the stamping pass and shrinks to empty once it drains; **the `IS DISTINCT FROM` comparison needs an expression index or a generated `is_stale` column, and that is the part needing design.** Trigger/cost: not fixed at authoring time on merit rather than as a deferral — `personalities` holds one row per character definition, so a seq scan every 10 minutes is far cheaper than maintaining an index on a table that takes writes on every character edit and import. Promote when `personalities` exceeds ~10k rows, or the sweep shows up in slow-query logs. **NARROWED (2026-09-04): the cron-schedule half of this row already shipped** — the schedule was corrected to `4,14,24,34,44,54 * * * *` in commit `125dd3b5a` under TASK-681, so only the two index questions remain. Evidence 2026-09-04: `git grep -n "4,14,24,34,44,54" services/ai-worker/src/index.ts` → confirms the corrected schedule; `awk '/model Personality {/,/^}/' prisma/schema.prisma | grep "@@index"` → only `slug`/`ownerId` indexes, no `card_source_hash` index.

## Superseded tasks (2026-09-04 pass)

TASK-280, TASK-289, TASK-340, TASK-679
