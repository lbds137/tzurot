## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.237 (theme: open — the TASK-705 debug cleanup plus the doc-7 drain)

_Drafted at the beta.236 cut (2026-10-12). beta.236 shipped #2590–#2612 (22 PRs / 7 runtime / 165 files / 92 commits): the job time budget (#2592), the message_metadata jsonb-null fix (#2598), the security overrides (#2590), and the commit-guard hardening series._

- **In already**: nothing yet.
- **Waiting on**: TASK-705 phase 2 and the `debug:` removal of #2601's capture, once prod logs show `guildInfoAmbiguousRoles`; carried from beta.235/236: the joint Spacebar/Machloket boot TR exercise (TASK-1137; needs Lila + the Machloket client session — the fork's A10/M1 enforcement notes are in the roles boot-b section), TASK-1153 (overrides pin-form audit, next time the block is touched), TASK-1150/1151 (ride the next skills PR), the doc-61 economy pass ~2026-10-31, TASK-1197 (ladder backoff derived from retry.ts, rides the next retry.ts touch).
- **Watches**: #2592's `LLM job budget exhausted before …` log line on the first real trigger; #2587's drift alert on prod (silence = all configured models catalog-healthy; the first real alert validates the full path); #2582's retarget-exclusion log line on the next real retarget; #2586's Both slot per the CURRENT.md smoke checklist; #2583's guest footer (piggyback kill-switch flip on dev); TASK-1179 (http-cache-semantics, no patch yet); the `doc-17` gap-bucket cache reading (decides caching Phase 3); carried: the first quoted/forwarded voice transcription on prod (#2548), the reminder-DM first prod cohort, the `/inspect` masked-link render (#2259).
- **🧑‍💻 Owner to-do** (carried): the beta.235 smoke checklist in CURRENT.md (items 1-2 need-smoke); the beta.230/232-era PROD smokes were skipped by the 2026-10-01 ruling; the TASK-1039 second read day at N=3, then N back to 10 on Emily and Lilith; TASK-907 commitment-facts review; TASK-1048 break-it pass (merged from TASK-1049; fresh session); TASK-104 voice-reference trims; leisure: card-level examples for Emily, the voice-harness blind review.
- **Owner decisions**: none open. TASK-1178 ruled KEEP 2026-10-05 (low watch; reopens when the largest persona/personality pair passes ~25k memories).
- **Explicitly NOT in**: the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913 watches) · the agentic `/memory remember` · caching Phase 3 until the doc-17 reading · doc-107 until the digest shape settles.
- **Deploy notes**: no migrations pending. Keep the range at or below ~117 commits for a normal `gh pr merge --rebase` (beta.229/230/233 needed the fast-forward fallback above that). If pushes fail with GH007, check the owner's GitHub "block command line pushes that expose my email" setting first. A push touching discord.js-adjacent files must run `pnpm ops surface:inventory --write` first; since #2593 (TASK-1194) the pre-push gate checks it too.
- **Cut when**: the backstops (~10 runtime PRs / ~250 files) fire; current values 0 / 0 at the cut. No single named item gates this train.
- **vNext+1 sketch**: caching Phase 3 (gated on the doc-17 gap-bucket reading) or the memory-archive rollout continuation, per which gate opens first.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

