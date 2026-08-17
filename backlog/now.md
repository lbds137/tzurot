## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **GLM 5.3 fallback: the known-doomed demotion path loses the rate-limit category, starving the retarget tier — MECHANISM RUNTIME-PINNED (prod logs, 2026-08-17 01:47–01:57 UTC)** — three fallback tiers exist: (1) z.ai-direct, (2) `AutoPromotionFallback` → OpenRouter same-model, (3) `QuotaFallback` retarget to the admin default. GLM 5.3 makes tier 2 a guaranteed 400 (staggered OpenRouter release — `z-ai/glm-5.3 is not a valid model ID`). Turn A (01:47:56): live z.ai 429 → tier 2 400s ×3 → tier 3 fires on the propagated **rate_limit** category → retargets to `z-ai/glm-5` → SUCCESS (owner's second screenshot). Turn B (01:53:41): the 429 was CACHED (`RateLimitCache`, user-scoped, 15-min TTL) → `PromotionDemotion` skips z.ai ("known-doomed") straight to tier 2 → 400 ×3 → failure surfaces as **bad_request**, which `QuotaFallback` doesn't react to → dead end, in-character error (ref `mswky34dbpd`). **Root cause: the cached-rate-limit demotion converts a rate-limit situation into a bad_request failure, losing the exact trigger tier 3 needs.** Fix shapes: (a) general — a failure downstream of a `PromotionDemotion(category=rate_limit/quota_exceeded)` retains the demotion's category for QuotaFallback eligibility; (b) hardening — don't demote/fall back to an OpenRouter id absent from the catalog (NOTE: `ModelCapabilityChecker` logged "Model catalog unavailable — pattern-fallback" throughout this window, so (b) needs the catalog-unavailability question answered first — possibly its own bug). Owner worked around via a GLM 5.2 preset (tier 2 succeeds there — 5.2 exists on OpenRouter, verified same window 01:56–01:57). Natural beta.204 rider. Filed 2026-08-16 (night); mechanism pinned same night. **Code-grounded 2026-08-17** (read, not assumed): the dead end is the eligibility gate at `quotaFallbackRunner.ts:123-126` — `const category = classifyQuotaFailure(originalError); if (category === null) throw originalError;`. Classification runs on the error's own message regexes, so Turn A passed (its `originalError` WAS the live 429) and Turn B failed (its `originalError` is the demoted route's 400, because z.ai was skipped proactively and never produced an error). `tryPromotionDemotion` DOES carry the category — it returns `quotaFallback: { category, mode: 'proactive' }`, threaded onto the auth at `AuthStep.ts:193` — but `GenerateAttemptOpts` (`autoPromotionFallback.ts:43-58`) has no field for it, so the fact is dropped before the gate reads it. Fix shape (a) is therefore a three-point thread, not a redesign: add an inherited-category field to `GenerateAttemptOpts`, populate it from `llmAuth.quotaFallback.category`, and read it at the gate as `classifyQuotaFailure(originalError) ?? opts.inheritedQuotaCategory`. **Open call for the owner before building**: this widens tier-3 eligibility so ANY downstream failure after a rate-limit demotion becomes retarget-eligible, including bad_requests unrelated to quota — defensible (the user genuinely IS rate-limited, and it makes Turn B behave like the observed-succeeding Turn A), but it is a semantic widening rather than a bug fix, so it wants a deliberate yes. _(Same log window also closed the #2117 observability item: `cacheHitRatio=0.62`, `promptHash*` fields all live.)_

---

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
- **Cut when**: PR 0–2 shipped + rollout-week telemetry read. Backstops: ~10 runtime PRs / ~250 files. **PR 1 = #2123, PR 2 = #2124 (both merged); PR 0's purpose is met — its measurements are in doc-17, the scripts were scratch by design.**
- **PRE-DEPLOY BASELINE for the rollout read (TASK-641, 2026-08-17)** — measured BEFORE the hysteresis reaches prod, so the post-deploy read is a real before/after rather than an absolute number. Same command both sides: `pnpm ops cache:prefix-diff --env prod --channel <id>`. Channel `1498247824662335608`: 12/12 pairs cut at `H chat_log`, offsets 27,451-27,465, cached 5,632 tok, 29-32%. Channel `1481138179917615144`: 7/8 at `H chat_log`, offsets 32,334-32,451, cached 6,656 tok, 29-30%. Success = the cut moves DEEPER into chat_log (offset up, cached up); the mechanism is confirmed, only the size of the win is open.
- **Confound to control for**: #2129 (participant `<about>` attribution lead-in) adds bytes INSIDE S1, which shifts every offset after it. If #2129 rides this release, compare cached-token COUNTS and percentages, not raw offsets, against the baseline above — and expect one free cache miss per channel on deploy as the new S1 prefix warms.

### 🎯 Current Focus (max 3)

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic.)_

- ✨ `[FEAT]` **Slash chat turns should mirror raw tagging in activated channels** — owner directive 2026-07-21 (Wave-3 smoke): `/chat`/`/random`/`/chime-in` should "behave as similarly as possible to regular tagging," i.e. the channel's activated character replies to a slash turn too (today the bot-authored echo is dropped by `BotMessageFilter`, so activation never fires — one reply instead of the raw-message two). Needs scoping in the shared turn engine (`services/character/characterTurn.ts`): dedup when the invoked character IS the activated one, reply ordering, second model call per turn. Behavior change only — no command-shape change, does NOT need the breaking batch.

