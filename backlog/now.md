## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.238 (theme: the TASK-1230 LTM export, plus the doc-7 drain)

_Drafted at the beta.237 cut (2026-10-17). beta.237 shipped #2614–#2626 (7 PRs / 7 runtime / 190 files): summarizer prompt v2 (#2626, eval 97.2% faithful / 0 content-serious), the no-summary render fallback (#2622), the facts query filter (#2615), the memory-date recency wording (#2614), and the BYOK lastUsedAt pair (#2623/#2620). Cut rode the backstop's approachability (7/10 runtime at cut) with the theme item watch-gated — divergence stated in the release PR body._

- **In already**: nothing yet.
- **Waiting on**: TASK-1230 (high, M — LTM export for all LTM users + the privacy-policy line; owner ruled 10-15: build after the 10-18 reset); the release-day prod backfill (TASK-1227 close-out — staged command in CURRENT.md's beta.237 watch, owner go-ahead first, could land before this train's first PR); carried from beta.236/237: TASK-705 phase 2 + the `debug:` removal of #2601's capture (watch-gated on prod `guildInfoAmbiguousRoles`), the joint Spacebar/Machloket boot TR exercise (TASK-1137; needs Lila + the Machloket client session), TASK-1153 (overrides pin-form audit, next time the block is touched), TASK-1150/1151 (ride the next skills PR), the doc-61 economy pass ~2026-10-31, TASK-1197 (ladder backoff derived from retry.ts, rides the next retry.ts touch).
- **Watches**: the beta.237 set in CURRENT.md (overflow/dead + lengthState rates on the v2 summarizer; the backfill's dead-row recovery/re-strike read; `excerptNotes` share; #2592's budget line; #2601's `guildInfoAmbiguousRoles` capture); #2587's drift alert on prod (silence = catalog-healthy); #2582's retarget-exclusion log line; #2586's Both slot per the CURRENT.md smoke checklist; #2583's guest footer (piggyback kill-switch flip on dev); the `doc-17` gap-bucket cache reading (decides caching Phase 3); carried: the first quoted/forwarded voice transcription on prod (#2548), the reminder-DM first prod cohort, the `/inspect` masked-link render (#2259).
- **🧑‍💻 Owner to-do** (carried): the beta.235 smoke checklist in CURRENT.md (items 1-2 need-smoke); the beta.230/232-era PROD smokes were skipped by the 2026-10-01 ruling; the TASK-1039 second read day at N=3, then N back to 10 on Emily and Lilith; TASK-907 commitment-facts review; TASK-1048 break-it pass (merged from TASK-1049; fresh session); TASK-104 voice-reference trims; the `/settings data export` re-run (due 2026-11-09, skippable if TASK-1230 ships); leisure: card-level examples for Emily, the voice-harness blind review.
- **Owner decisions**: none open. TASK-1178 ruled KEEP 2026-10-05 (low watch; reopens when the largest persona/personality pair passes ~25k memories).
- **Explicitly NOT in**: the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913 watches) · the agentic `/memory remember` · caching Phase 3 until the doc-17 reading · doc-107 until the digest shape settles · #2624 dependabot prod-deps (held: zod 4.6.7 union-error shape; revisit after upstream/next patch) · the doc-112 chat CLI build (ingestion-only ruling 10-13; scheduling is the owner's pick, don't push it).
- **Deploy notes**: no migrations pending. Keep the range at or below ~117 commits for a normal `gh pr merge --rebase` (beta.229/230/233 needed the fast-forward fallback above that). If pushes fail with GH007, check the owner's GitHub "block command line pushes that expose my email" setting first. A push touching discord.js-adjacent files must run `pnpm ops surface:inventory --write` first; since #2593 (TASK-1194) the pre-push gate checks it too.
- **Cut when**: the backstops (~10 runtime PRs / ~250 files) fire; current values 0 / 0 at the cut. No single named item gates this train.
- **vNext+1 sketch**: caching Phase 3 (gated on the doc-17 gap-bucket reading) or the memory-archive rollout continuation (Emily's flip gate: ≥95% summarized share — reachable once the release-day backfill + organic re-admission clear the failed tail), per which gate opens first.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

