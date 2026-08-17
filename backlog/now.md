## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **Prod Postgres lock timeouts, 15:24–16:32 UTC 2026-07-12** — recurring `canceling statement due to lock timeout` on gateway writes: ≥6 conversation-history persists failed fail-soft (replies delivered, history rows missing) and a character import timed out at 16:29 (succeeded on 16:35/16:37 retries). NOT db-sync (last completed 14:37), NOT retention (no runs logged). Probe ran (owner-approved, ~17:55 UTC): **no live contention, no in-transaction sessions** — the holder released before observation and is now unidentifiable. Structural finding: server-level `idle_in_transaction_session_timeout=0` (and `lock_timeout=0`/`statement_timeout=0`) — a wedged idle-in-transaction connection can hold locks indefinitely; only our app-pool timeouts contained the damage. Mitigation LIVE IN PROD (#1606, released in beta.161 2026-07-12): main-pool `idle_in_transaction_session_timeout=60s` reaps app-held wedged transactions. Holder identity remains unknown; an EXTERNAL wedged session (DB console) is out of the guard's reach — DB-level `ALTER DATABASE` is the escalation if it recurs post-release. Next occurrence: run the `pg_stat_activity`/`pg_blocking_pids` probe DURING the window (one-off script per the session's `lock-probe.ts`). Filed 2026-07-12.

---

- 🐛 `[FIX]` **Deploy-orphaned multi-tag rehydration wedges a thread for 18 min — (a)+(c) MERGED to develop (#1642); (b) has a code-read answer needing runtime confirmation** — Full runtime trail 2026-07-14 00:45–01:05 UTC (owner's beta.164 smoke test, diary thread `1526195612780069014`): an in-flight mention job died with the old ai-worker at the deploy; at boot the multi-tag recovery rehydrated its group (`df45b932`, `slotsTrustedToStream=1`) and parked it at the head of the thread's ordered-delivery queue. Observed: (1) every subsequent reply silently queued behind the ghost for 18 min; (2) safety timeout flushed at 01:04:53 (synthetic error + queued replies in order); (3) both replies voiceless — their TTS audio outlived the 300s `tts-audio:` TTL while wedged. **RELEASED in v3.0.0-beta.165 (2026-07-14, #1642)**: safety-flush re-poll (a completed/failed job's REAL outcome delivers instead of a synthetic error), original-deadline re-arm (a restart never extends a wedge past createdAt+18min — the incident's ghost would have flushed ~6 min sooner), `tts-audio:` TTL 300s→`MULTI_TAG.REDIS_TTL_SEC` (30 min, invariant-tested). Runtime verification is now possible — the next deploy-orphan or safety-flush event proves it (watch the `remainingBudgetMs` rehydration log + the re-poll's "found a real job outcome" line). **Fix shape (a) as originally filed was unimplementable** — a deploy-killed job's BullMQ lock (`WORKER_LOCK_DURATION`=20 min) outlives the whole safety window, so a dead 'active' job is indistinguishable from a live one at rehydration; the PR ships the honest equivalents. **(b) DECIDED + SHIPPED — #1647 (2026-07-14, merged to develop)**: verified against installed BullMQ 5.80.2 source — locks auto-renew (lockDuration/4 cadence), so lockDuration was never max-runtime and never caught hung jobs (a hung-but-alive worker renews forever; in-process timeouts are that defense); its only function is dead-process detection. Deploy-killed jobs were ALREADY stall-re-running at ~20min (maxStalledCount=1 default fails only on the SECOND stall) — after the flush, spend wasted. Shipped: lock 20min→5min (orphan re-runs deliver real replies ~6-7 min post-deploy), `MAX_JOB_RUNTIME` decouple (calculateJobTimeout clamp unchanged at 20min — the hidden coupling that made the naive change dangerous), explicit maxStalledCount, `stalled`-event logging (the recovery trail was invisible), invariant tests pin lock≪flush<runtime-ceiling. Close this entry when the fixes are release-verified (first prod deploy-orphan: expect a "Job stalled" warn + a real reply minutes later instead of an 18-min wedge). Filed 2026-07-14 (night); (b) shipped same day.


### 🚢 Next Release — beta.203: "z.ai thinking translation"

_The release plan: what the next cut IS, what it waits for, what it deliberately excludes. Drafted at the beta.202 cut (2026-08-16); revised whenever priorities shift. The cut-criterion here is the primary trigger; the count/file caps in `10-working-posture.md` § Ship in bounded units are backstops._

- **Theme**: finish doc-77 — after PR B, the five "(Reasoning: medium)" GLM presets are true for the first time (the false-advertising bug this Current Focus exists for).
- **In already**: `show_thinking` retirement (#2110, incl. data-only JSONB strip migration — applied to dev 2026-08-16; prod at the cut via premigrate, safe either order) · TASK-625 premigrate comment-blind detector fix (#2111) · **doc-77 PR B (#2112)** — z.ai `thinking`/`reasoning_effort` translation + allowlist flip · **doc-77 PR C (#2114)** — warn-only save-time validation · **GLM-5.3 catalog (#2115)** — 1M context, measured best-effort thinkingOff; completes doc-77 · **TASK-629 (#2116)** — image-only reference stubs carry a media preview · **TASK-630 (#2117)** — cache-observability log fields (gap + prefix hashes + hit ratio; z.ai `cached_tokens` mapping verified in LangChain source) · **TASK-620 (#2118)** — guest-mode substitution announced in the footer · **TASK-626 (#2119)** — assistant-persist retry + isolated slash persists + chunk-id semantics · **TASK-634 (#2120)** — retention nag gated to prod; purge+notify confirm in every env (owner's pre-cut gate).
- **Waiting on**: _empty (2026-08-16) — cut criterion met; cut proposal pending owner approval._
- **Deploy notes**: owner dev smoke for PR B ✅ PASSED 2026-08-16 (requestId `06dd8b51`). #2110's migration applied to dev; prod rides `release:premigrate` at the cut. Nothing else outstanding.
- **Explicitly NOT in**: doc-17 count-cap hysteresis (needs design — the measurement refined §2.5; the win is ~14-19k tokens/turn, so it's a strong vNext+1 theme candidate).
- **Cut when**: the waiting-on list is empty. Backstops: ~10 runtime PRs / ~250 files.
- **vNext+1 sketch**: doc-17 §2.5 hysteresis (count-cap layer) · TASK-622 roster stability.

### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Reasoning controls are false advertising — PROMOTED 2026-08-14 (owner call, interrupts the drain)** — tracker `doc-77`. Owner: _"it's basically false advertising… this is gonna be user facing stuff, so it's gonna justify our next release."_ Runtime-confirmed on the z.ai-direct path: `effort` does nothing. Owner's dev discriminator, both requests pinned to `effectiveProvider="zai-coding"` by three independent log lines — `effort:none` → **1571 chars of reasoning**, `effort:high` → **1722**. Our schema documents `none` as "0% (reasoning disabled)". Prod census: **all 5 z.ai configs are `{effort:"medium", enabled:true}` and all 5 are named "(Reasoning: medium)"** — every GLM preset advertises a level it isn't running, and bills reasoning tokens the owner set to zero. Cause: we send OpenRouter's `reasoning` object to an endpoint whose thinking field is `thinking`; the 8-name strip list is a DENYLIST so a field added later defaults to being sent. The response direction already speaks z.ai's protocol (`reasoning_content`) — only the request direction never learned it. **THEME COMPLETE 2026-08-16** — every phase shipped: doc-73 (#2104/#2105/#2106), PR A (#2103), `show_thinking` retirement (#2110), PR B (#2112, translation + allowlist), PR C (#2114, warn-only save-time validation), GLM-5.3 catalog (#2115, measured best-effort). TASK-609 closed on the probe evidence. Exits Current Focus at the beta.203 cut.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (interrupted 2026-08-14 for the above; resume when it ships)** — tracker `doc-7`: the outflow campaign over the 334-task pool. Opening surfaces: `pnpm tracker task list -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic.)_

- ✨ `[FEAT]` **Slash chat turns should mirror raw tagging in activated channels** — owner directive 2026-07-21 (Wave-3 smoke): `/chat`/`/random`/`/chime-in` should "behave as similarly as possible to regular tagging," i.e. the channel's activated character replies to a slash turn too (today the bot-authored echo is dropped by `BotMessageFilter`, so activation never fires — one reply instead of the raw-message two). Needs scoping in the shared turn engine (`services/character/characterTurn.ts`): dedup when the invoked character IS the activated one, reply ordering, second model call per turn. Behavior change only — no command-shape change, does NOT need the breaking batch.

