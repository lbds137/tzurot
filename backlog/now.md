## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_(none active)_

_Recently resolved:_ the **z.ai coding-plan "routing bug"** (surfaced 2026-06-28/29) was diagnosed 2026-07-02 as **not a routing defect** — auto-promotion fired correctly; z.ai-direct failed transiently (late-June z.ai instability, mechanism log-verified 2026-06-30 in the same window), the OpenRouter rescue succeeded, and the footer honestly reported the effective route (`via OpenRouter`), which read as "key not honored." Diagnostic probe cancelled; the remaining code defect (error-path footer mis-attribution, same seam) is Current Focus #1 below. Earlier: the forwarded-message content-loss fix (#1391) and the TTS voice-output-dropped 300s stop-gap (#1389) shipped in **beta.142**; the DB connection-pool-starvation timeouts were fixed via #1250/#1251 and confirmed resolved 2026-06-25; the gateway persist-hang (soak-clean since beta.143; watch-items in `cold/follow-ups.md`) was a DIFFERENT failure mode (a single INSERT blocking with the pool healthy), not a pool-starvation regression.

---

### 🎯 Current Focus (max 3)

**🐛 `[FIX]` beta.146 warmup — thread the effective route through the auto-promotion both-fail path (error-footer mis-attribution)** — Phase 4 shipped 2026-07-01, so the "fix IN Phase 4" coupling is moot; the fix lands atop the shipped cascade. Full spec + root cause on the `cold/follow-ups.md` row ("Model footer mis-attributes the primary route…"). Open design call (user): on a both-fail error, does the footer follow the root-cause message (primary) or the last-attempted route (effective)? beta.144's #84eee440b already enriched the both-fail error MESSAGE; this closes the FOOTER half — and with it the z.ai "routing bug" confusion family.

**🏗️ `[LIFT]` Spinoff-theme knockout — the beta.146+ release focus (no new epic)** — User decision 2026-07-02: burn down the themes spun off from completed epics instead of picking a new epic from the queue. Roadmap + ordering in `active-epic.md`. Starts after the warmup items (Focus #1 + the Quick Wins below).

_beta.145 SHIPPED 2026-07-02 (14 PRs): all five openers + the backlog-shrink pass (#1447–#1450) + clean-first builds (#1451) + guard:workflow-sync (#1452 + main-cut #1454) + the TTS backfill test (#1453). Release review: "no changes requested."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- **🧹 `[CHORE]` Narrow `guard:workflow-sync` + the skill's main-cut rule to the claude workflows** — empirically confirmed on #1454 that the review-skip validation is file-scoped; the current all-files guard would false-fail the next routine ci.yml edit. Full spec on the `cold/follow-ups.md` row.
- **🧹 `[CHORE]` Supervised lifecycle exercise** — one `railway redeploy --service bot-client` (user present) exercises the beta.145 unified shutdown path (`log-and-live` policy) under observation; watch for the dispose sequence + clean exit in logs.
- **🧹 `[CHORE]` Verify TTS pointer resolution in prod** — a `/voice view` on a no-override user + one TTS generation confirms the tier-4 pointer read (resolver logs the source). Cheap, user-driven.

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
