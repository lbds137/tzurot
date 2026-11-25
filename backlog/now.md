## Now

_The hot surface — loaded at session start alongside `active-epic.md` and the tracker digest. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **TASK-1522 — vision chain exhausts under z.ai capacity + a burst (recurring daily).** 71 image placeholders across 11-24/25 by lane B's prod log read; tiers 1+2 share the z.ai pool, so under load the chain is one free floor deep. Lane A's next code unit after PR 2807.

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.251 (theme: caching Phase 3 + drain)

_beta.250 shipped 2026-11-24 (PR 2804); its smoke is CURRENT.md § beta.250 smoke._

- **Planned**: caching Phase 3 (doc-17 reading first; moved from beta.249 by Lila AUQ 2026-11-23) · TASK-1400 Claude character route if Lila's blind rating says GO, else TASK-1416/1415/1411/1412 · TASK-1519 lockfile regenerate · drain items (1511–1513, 1500–1508).
- **Waiting on**: the doc-17 reading; Lila's TASK-1400 verdict (`docs/local/task-1400-eval/blind-packet.md`).
- **Explicitly NOT in**: TASK-1356 (BYOK rotation redesign — design first, security-critical) · TASK-1347/1174 (design- or ops-sized, scheduled separately).
- **Deploy notes**: none yet.
- **Cut when**: caching Phase 3 merges; backstops ~10 runtime PRs / ~250 files (`pnpm ops release:range`). Release PR merge needs her explicit yes.
- **vNext+1 sketch (beta.252)**: Machloket e2e (`doc-114`) · whatever of TASK-1416/1415/1411/1412 beta.251 does not carry.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (owner ruled 2026-11-24: reset sameChannelVerbatimExchanges to 10 on Emily and Lilith, slice 2 ruled out; the reset is Lila's action on the prod Memory settings page). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

