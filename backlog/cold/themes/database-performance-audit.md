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
