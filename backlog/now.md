## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.241 (theme: the batch residue pass)

_Drafted at the beta.240 cut (2026-10-26). beta.240 shipped 6 PRs / 6 runtime / 65 files (#2663, plain rebase-merge): override batch clear (#2657), deny batch remove (#2661) closing doc-113, the fallthrough footer suffix (#2662), security overrides (#2660), dependabot groups (#2658/#2659), plus #2656 via main._

- **In already**: (empty at cut)
- **Waiting on**: TASK-1280. Shipped since the cut: TASK-1291 (PRs 2665-2667), TASK-1295 (PR 2668), TASK-1293 (PR 2669, tests only: the central CommandHandler catch already covers the path). Carried: TASK-705 phase 2 + the `debug:` removal of #2601's capture (watch-gated on prod `guildInfoAmbiguousRoles`), TASK-1137 (joint Spacebar/Machloket boot; needs Lila + the Machloket client session), TASK-1153, TASK-1150/1151, TASK-1197, the doc-61 economy pass ~2026-10-31.
- **Watches**: the beta.240 set in CURRENT.md (optional `/deny` batch smoke, LangChain minors on the AI path, fallthrough footer); carried beta.239/238/237 watches in CURRENT.md.
- **🧑‍💻 Owner to-do** (carried): the beta.235 smoke checklist in CURRENT.md; the TASK-1039 second read day at N=3, then N back to 10 on Emily and Lilith; TASK-907 commitment-facts review; TASK-1048 break-it pass; TASK-104 voice-reference trims.
- **Owner decisions**: TASK-1262 (no rush). TASK-1294 (deny cap copy: "showing newest 500" footer + at-cap pick note; rec yes).
- **Explicitly NOT in**: the doc-112 TUI/headless CLI (idea; widened 2026-10-25, not scheduled) · the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913) · caching Phase 3 until the doc-17 reading · doc-107.
- **Deploy notes**: no migrations planned. If one lands, `release:premigrate --force` is classifier-denied to the agent, so the owner runs it as a `!` line; `release:finalize --yes` was classifier-denied at the beta.240 cut too — expect to hand it over as a `!` line. Expect the rebase-merge to refuse above ~117 commits; the fast-forward fallback is the path. A push touching discord.js-adjacent files runs `pnpm ops surface:inventory --write` first. Driver eval Tue 10-27: the session idles clean for the owner's `/model sonnet` + `/advisor opus`.
- **Cut when**: TASK-1291 lands (its #11 correctness fix is the theme's anchor), or the backstops (~10 runtime PRs / ~250 files) fire first; `pnpm ops release:range` reads 0 at cut.
- **vNext+1 sketch**: caching Phase 3 (after the doc-17 reading) or the doc-114 Machloket e2e harness, whichever gate opens first.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). Machloket e2e theme seeded 10-24 (`doc-114`): the harness against Machloket dev A/B is the parity test surface; scope after the 1252..1256 drain batch; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

