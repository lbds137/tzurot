## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **Prod Postgres lock timeouts, 15:24–16:32 UTC 2026-07-12** — recurring `canceling statement due to lock timeout` on gateway writes: ≥6 conversation-history persists failed fail-soft (replies delivered, history rows missing) and a character import timed out at 16:29 (succeeded on 16:35/16:37 retries). NOT db-sync (last completed 14:37), NOT retention (no runs logged). Probe ran (owner-approved, ~17:55 UTC): **no live contention, no in-transaction sessions** — the holder released before observation and is now unidentifiable. Structural finding: server-level `idle_in_transaction_session_timeout=0` (and `lock_timeout=0`/`statement_timeout=0`) — a wedged idle-in-transaction connection can hold locks indefinitely; only our app-pool timeouts contained the damage. Mitigation LIVE IN PROD (#1606, released in beta.161 2026-07-12): main-pool `idle_in_transaction_session_timeout=60s` reaps app-held wedged transactions. Holder identity remains unknown; an EXTERNAL wedged session (DB console) is out of the guard's reach — DB-level `ALTER DATABASE` is the escalation if it recurs post-release. Next occurrence: run the `pg_stat_activity`/`pg_blocking_pids` probe DURING the window (one-off script per the session's `lock-probe.ts`). Filed 2026-07-12.

---

### 🚢 Next Release — beta.204 (theme: count-cap hysteresis — CONFIRMED, design ACCEPTED)

_The release plan: what the next cut IS, what it waits for, what it deliberately excludes. Drafted at the beta.203 cut (2026-08-16); theme confirmed + design accepted same day. The cut-criterion here is the primary trigger; the count/file caps in `10-working-posture.md` § Ship in bounded units are backstops._

- **Theme (CONFIRMED 2026-08-16)**: history-window count-cap hysteresis — the ~14-19k tokens/turn caching win. **Design ACCEPTED**: [`prompt-assembly-architecture.md` §2.5.2](../docs/proposals/backlog/prompt-assembly-architecture.md) (quad council + owner pass; 25% chunk, 20-message floor, one repeatable-read transaction, telemetry meta). Build slices: **PR 0** z.ai TTL/discount probe (script-only) → **PR 1** TASK-622 roster stabilization (co-requisite, both halves owner-decided) → **PR 2** ConversationHistoryService windowed fetch (+EXPLAIN-decided index). Opus-session executable — the design is settled; workers build to spec.
- **Rider candidates**: TASK-636 (model-footer dedupe, owner-proposed shape) · drain-campaign batches as they land.
- **In already**: _(nothing — beta.203 cut 2026-08-16)_
- **Waiting on**: the build itself (no open decisions).
- **Deploy notes**: no migrations expected unless PR 2's EXPLAIN adds the `[channelId, createdAt]` index (additive, premigrate-safe). Rollout week reads `cacheHitRatio`/prefix-diff before declaring the win.
- **Explicitly NOT in**: memory overhaul (doc-8, parked) · doc-64/65/66/67 idea docs (council queue) · token-budget-layer eviction (stays dormant by design, §2.5.1).
- **Cut when**: PR 0–2 shipped + rollout-week telemetry read. Backstops: ~10 runtime PRs / ~250 files.

### 🎯 Current Focus (max 3)

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic.)_

- ✨ `[FEAT]` **Slash chat turns should mirror raw tagging in activated channels** — owner directive 2026-07-21 (Wave-3 smoke): `/chat`/`/random`/`/chime-in` should "behave as similarly as possible to regular tagging," i.e. the channel's activated character replies to a slash turn too (today the bot-authored echo is dropped by `BotMessageFilter`, so activation never fires — one reply instead of the raw-message two). Needs scoping in the shared turn engine (`services/character/characterTurn.ts`): dedup when the invoked character IS the activated one, reply ordering, second model call per turn. Behavior change only — no command-shape change, does NOT need the breaking batch.

