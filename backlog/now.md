## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.247 (theme: burst coalescing in activated channels + cache observability)

_Drafted 2026-11-18 after beta.246 (shipped 13:21Z, PR 2768; 13 runtime PRs, 151 files; the beta.246 prod acceptance checks live in CURRENT.md § beta.246 watch)._

- **In already**: doc-66 burst coalescing, "latest wins" per (channel, personality) (PR #2769, merged 11-19; rulings in doc-66) · TASK-1450 cache tokens into `usage_logs` + telemetry hit rate (PR #2770, merged 11-19; dev migrated; task stays open for the one-week prod-row check).
- **Waiting on**: TASK-1443 (settings discoverability fixes from the command-tree audit, filed "after beta.246") — IN FLIGHT 11-19, spec `docs/local/dispatch/task-1443-spec.md`.
- **Explicitly NOT in**: TASK-1411 (close-the-train enforcement; tooling, ships any time) · TASK-1416 (low, detection consolidation) · TASK-1415 (observable) · review residue TASK-1451/1452/1453 (low; drain) · TASK-1433 (medium, revoked z.ai key retried per image; a rider if a unit lands early) · TASK-1039/1346/671 (owner-gated or design-sized) · caching Phase 3 (doc-17 reading).
- **Deploy notes**: doc-66 changes user-visible reply behavior in activated channels; semantics CONFIRMED 11-18 (AUQ "Activated chatter only": explicit @mentions and replies stay 1:1; memory stays per message; ruling in doc-66). TASK-1450 adds columns, so a migration: premigrate before the release merge.
- **Cut when**: the three waiting-on units are merged to develop; backstops ~10 runtime PRs / ~250 files (`pnpm ops release:range`; 0 at drafting). The release PR merge needs her explicit yes.
- **vNext+1 sketch (beta.248)**: doc-17 reading → caching Phase 3 · TASK-1411 · TASK-1416.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

