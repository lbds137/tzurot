## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **Guest turns dead-end terminal when the free default rate-limits — no hop to the openrouter/free floor** (owner report 2026-08-19 night, ref `mt0x7rafokw`; log-corroborated episodes 2026-08-20T00:02:55Z + 00:19:43Z). A guest turn is proactively substituted to the free default, so when THAT model 429s (live or via `RateLimitCache`'s 15-min window), `selectQuotaFallbackTarget`'s `config.model === failingModel` guard returns null and the runner rethrows — the floor (`selectFloorTarget` guest arm = `openrouter/free`) is only reachable through a hop-1 attempt a guest-at-the-default can never have. Full mechanism + fix shape: **TASK-694** (Done). **Fix MERGED in #2155 (2026-08-20)** — floor promoted to hop 1 on any null tiered target; guest non-OpenRouter credential arm resolves the system key. **Runtime-UNVERIFIED** (dev can't force an upstream 429): the watch signal on the next prod rate-limit window is the ai-worker log line `No hop-1 retarget available — promoting the floor to the hop-1 target`. Remove this entry once that line is observed rescuing a real turn. Edge-hardening follow-up: TASK-697. Adjacent to TASK-645 (hop-1 retry unclassifiable) but distinct: this is hop-1 having NO TARGET. Immediate mitigation available to the owner: point the free-default preset at `openrouter/free` directly.

- 🐛 `[FIX]` **PARKED — Reply-ping toggle is ignored — replying to a character with the ping OFF still triggers it** (owner intake 2026-08-17, prod). **TASK-649 was ARCHIVED by owner call 2026-08-18** ("archive 649 for now, unless Discord changes something later") — the bug is not fixed, it is UNRESOLVABLE without a Discord runtime capture we cannot currently take, so it is parked rather than closed. Kept here rather than deleted because the prod symptom is real and a reader needs to know why nothing is happening. **A fix branch exists and is unmerged: `origin/fix/reply-ping-gate`, 5 commits (3 of them fixups) ahead of develop** — it implements the code-read fix that must NOT ship without the capture. Do not delete that branch; do not merge it on the code-read alone. Full analysis + fix shape + the open runtime question are in the archived task file (`tracker/archive/tasks/task-649 - *.md`). Short form: the inbound ping signal is never consulted (`PersonalityTriggerProcessor.resolveReplyPersonality` gates only on `message.reference`), and `mentions.repliedUser` is NOT that signal — discord.js populates it on every reply, so the discriminator is membership in `mentions.users`. **Do not ship to prod on the code-read alone**: whether Discord lists a WEBHOOK author in `mentions` when the ping is ON needs a dev capture first, because a wrong answer suppresses every reply.

- 🐛 `[FIX]` **GLM 5.3 fallback — ALL FIX SHAPES SHIPPED; runtime-watch remnant.** (a) inherited-category thread shipped in beta.204 (#2128). **(b) catalog-absent fallback veto SHIPPED in #2220 (2026-08-25)** — target selection probes the OpenRouter catalog and vetoes confirmed-absent OpenRouter-bound targets, fail-open on catalog unavailability. #2220 ALSO made the incident's own 400 wording (`… is not a valid model ID`) classify as MODEL_NOT_FOUND directly, so **the Turn-B shape now rescues standalone, without the inherited category** — the recorded open owner call about (a)'s semantic widening is partially obviated (the inherited mechanism stays for genuinely-unclassifiable failures). **Runtime-UNVERIFIED, the only reason this entry stays**: watch for a prod retarget succeeding where Turn B previously dead-ended (footer announcing a swap on a staggered-release model, or a `model_not_found (rescued)` ⚠️ embed in the error channel — #2220 also reports successful rescues there). Remove this entry on that observation. The same dead-end shape one hop down is **TASK-645**. Original incident analysis below (kept for the mechanism; the fix-shape half is now history).

<details><summary>Original 2026-08-16/17 incident analysis</summary>

three fallback tiers exist: (1) z.ai-direct, (2) `AutoPromotionFallback` → OpenRouter same-model, (3) `QuotaFallback` retarget to the admin default. GLM 5.3 makes tier 2 a guaranteed 400 (staggered OpenRouter release — `z-ai/glm-5.3 is not a valid model ID`). Turn A (01:47:56): live z.ai 429 → tier 2 400s ×3 → tier 3 fires on the propagated **rate_limit** category → retargets to `z-ai/glm-5` → SUCCESS (owner's second screenshot). Turn B (01:53:41): the 429 was CACHED (`RateLimitCache`, user-scoped, 15-min TTL) → `PromotionDemotion` skips z.ai ("known-doomed") straight to tier 2 → 400 ×3 → failure surfaces as **bad_request**, which `QuotaFallback` doesn't react to → dead end, in-character error (ref `mswky34dbpd`). **Root cause: the cached-rate-limit demotion converts a rate-limit situation into a bad_request failure, losing the exact trigger tier 3 needs.** Fix shapes: (a) general — a failure downstream of a `PromotionDemotion(category=rate_limit/quota_exceeded)` retains the demotion's category for QuotaFallback eligibility; (b) hardening — don't demote/fall back to an OpenRouter id absent from the catalog (NOTE: `ModelCapabilityChecker` logged "Model catalog unavailable — pattern-fallback" throughout this window, so (b) needs the catalog-unavailability question answered first — possibly its own bug). Owner worked around via a GLM 5.2 preset (tier 2 succeeds there — 5.2 exists on OpenRouter, verified same window 01:56–01:57). Natural beta.204 rider. Filed 2026-08-16 (night); mechanism pinned same night. **Code-grounded 2026-08-17** (read, not assumed): the dead end is the eligibility gate at `quotaFallbackRunner.ts:123-126` — `const category = classifyQuotaFailure(originalError); if (category === null) throw originalError;`. Classification runs on the error's own message regexes, so Turn A passed (its `originalError` WAS the live 429) and Turn B failed (its `originalError` is the demoted route's 400, because z.ai was skipped proactively and never produced an error). `tryPromotionDemotion` DOES carry the category — it returns `quotaFallback: { category, mode: 'proactive' }`, threaded onto the auth at `AuthStep.ts:193` — but `GenerateAttemptOpts` (`autoPromotionFallback.ts:43-58`) has no field for it, so the fact is dropped before the gate reads it. Fix shape (a) is therefore a three-point thread, not a redesign: add an inherited-category field to `GenerateAttemptOpts`, populate it from `llmAuth.quotaFallback.category`, and read it at the gate as `classifyQuotaFailure(originalError) ?? opts.inheritedQuotaCategory`. **Open call for the owner before building**: this widens tier-3 eligibility so ANY downstream failure after a rate-limit demotion becomes retarget-eligible, including bad_requests unrelated to quota — defensible (the user genuinely IS rate-limited, and it makes Turn B behave like the observed-succeeding Turn A), but it is a semantic widening rather than a bug fix, so it wants a deliberate yes. _(Same log window also closed the #2117 observability item: `cacheHitRatio=0.62`, `promptHash*` fields all live.)_

</details>

---

- 🐛 `[FIX]` **Prod Postgres lock timeouts, 15:24–16:32 UTC 2026-07-12** — recurring `canceling statement due to lock timeout` on gateway writes: ≥6 conversation-history persists failed fail-soft (replies delivered, history rows missing) and a character import timed out at 16:29 (succeeded on 16:35/16:37 retries). NOT db-sync (last completed 14:37), NOT retention (no runs logged). Probe ran (owner-approved, ~17:55 UTC): **no live contention, no in-transaction sessions** — the holder released before observation and is now unidentifiable. Structural finding: server-level `idle_in_transaction_session_timeout=0` (and `lock_timeout=0`/`statement_timeout=0`) — a wedged idle-in-transaction connection can hold locks indefinitely; only our app-pool timeouts contained the damage. Mitigation LIVE IN PROD (#1606, released in beta.161 2026-07-12): main-pool `idle_in_transaction_session_timeout=60s` reaps app-held wedged transactions. Holder identity remains unknown; an EXTERNAL wedged session (DB console) is out of the guard's reach — DB-level `ALTER DATABASE` is the escalation if it recurs post-release. Next occurrence: run the `pg_stat_activity`/`pg_blocking_pids` probe DURING the window (one-off script per the session's `lock-probe.ts`). Filed 2026-07-12.

---

### 🚢 Next Release — beta.209 (theme: doc-78 DM context isolation + deny-UX pair)

_Theme decided 2026-08-26 (owner pick at the usage stocktake). Build posture: Opus-driver week (Fable meter over trajectory — see CURRENT.md § Open items), which is why the theme is execution-heavy by intent: doc-78's design is already settled._

- **Theme**: doc-78 — DM context isolation (enum `shareHistoryAcrossPersonalities`, default `always`; no migration). Design + 7 registration sites + runtime evidence live in tracker doc-78.
- **Riding**: owner-taste pair TASK-764 (/deny add UX redesign — owner verbatim: clunky and confusing) + TASK-765 (thread-only denials) — needs the owner's UX taste round before build.
- **Filler between PRs**: drain-batch slices (doc-7; ~107 `state:ready` tasks).
- **In already**: (empty — grows as PRs merge)
- **Waiting on**: doc-78 build slices · the owner's deny-UX taste round.
- **Explicitly NOT in**: memory overhaul (doc-8, parked) · TASK-730 (owner call pending) · doc-12 P2 (build-on-demand by design) · council-queue docs (design-heavy — wrong fit for an Opus week).
- **Deploy notes**: nothing pending; no migration queued (doc-78 needs none).
- **Cut when**: the theme lands, or the backstops fire (~10 runtime PRs / ~250 files — `pnpm ops release:range` for live values).

### 🎯 Current Focus (max 3)

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

