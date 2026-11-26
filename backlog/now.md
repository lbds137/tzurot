## Now

_The hot surface — loaded at session start alongside `active-epic.md` and the tracker digest. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one) · TASK-1522 (#2809 vision paid floor past the tier cap, ships beta.251; closes on a prod image walk reaching the floor instead of a placeholder). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.252 (theme: message actions + drain)

_beta.251 shipped 2026-11-26 (PR 2817; cut ahead of Phase 3 on Lila's call 11-25); its smoke is CURRENT.md § beta.251 smoke._

- **In already**: nothing yet.
- **Planned**: TASK-1558 + TASK-1559 message actions Chime In + Edit Character (Lila 11-26, wanted in this release) · TASK-1560 z.ai cache hit rate halved since August (takes Phase 3's slot, Lila 11-26; Phase 3 markers DEFERRED, trigger in doc-17) · #2816 (B) · TASK-1400 Claude character route if Lila's blind rating says GO, else TASK-1416/1415/1411/1412 · TASK-1519 lockfile regenerate · drain items (1513, 1500–1508).
- **Waiting on**: Lila's TASK-1400 verdict (`docs/local/task-1400-eval/blind-packet.md`).
- **Explicitly NOT in**: TASK-1356 (BYOK rotation redesign — design first, security-critical) · TASK-1347/1174 (design- or ops-sized, scheduled separately) · #2815 / TASK-1553 (tooling; merges whenever its last review round lands, no release dependency).
- **Deploy notes**: none yet.
- **Cut when**: TASK-1558/1559 and TASK-1560 merge; backstops ~10 runtime PRs / ~250 files (`pnpm ops release:range`; 0 at cut). Release PR merge needs her explicit yes.
- **vNext+1 sketch (beta.253)**: Machloket e2e (`doc-114`) · whatever of TASK-1416/1415/1411/1412 beta.252 does not carry.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: none (TASK-1039 closed 2026-11-24: N reset to 10 at the user level, slice 2 ruled out). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

### 📌 Standing notes

_Permanent facts a session needs to recognise, not work items._

- **Permanent bot branch `usage-meter`** (#2820): the plan usage reading that `.claude/hooks/cloud-gate.sh` reads on cloud VMs. The owner's machine publishes it (deck-platform `bin/usage-publish`), appending a commit per changed reading plus a heartbeat (about 72 a day). The owner's ruling also calls for weekly pruning; that isn't built yet and is tracked in deck-platform TASK-383. It is public by the owner's ruling (2026-11-25): usage %, reset times and the verdict only. Never merge, rebase or delete it: without it, every cloud session refuses work.
- **Every cloud session refuses work?** Read its `cloud-gate:` line. "no usage reading (git fetch … failed)" means the VM could not fetch `usage-meter`. A cloud VM did fetch it on 2026-11-26 (git 2.43.0, `cloud-gate: go`), so a failure means the proxy or the branch changed. A stale or stop reading means the owner's publisher or plan, not this repo. No setting turns the gate off: recover by reverting the hook's `SessionStart` entry in `.claude/settings.json` from the owner's machine, since a refused cloud session will not do it.

