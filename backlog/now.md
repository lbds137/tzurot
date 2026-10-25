## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.240 (theme: finish the doc-113 multi-select batch family)

_Drafted at the beta.239 cut (2026-10-25). beta.239 shipped 22 PRs / 13 runtime / 239 files: memory facts, memory browse/search and alias batch actions (#2652-#2654), the boot-time egress-ban probe (#2646), drift-alert and tag-input fixes, dependency bumps that clear the vite/@vitest/mocker advisories. Main fast-forwarded (rebase-merge refused at 154 commits)._

- **In already**: none at cut time.
- **Waiting on**: TASK-1255 (#2657, override browser batch clear + the shared batch-result helpers) · TASK-1256 (deny, unspecced) · TASK-1291 (batch report mislabels found by the GLM-era re-review). Carried: TASK-705 phase 2 + the `debug:` removal of #2601's capture (watch-gated on prod `guildInfoAmbiguousRoles`), TASK-1137 (joint Spacebar/Machloket boot; needs Lila + the Machloket client session), TASK-1153, TASK-1150/1151, TASK-1197, the doc-61 economy pass ~2026-10-31.
- **Watches**: the beta.239 set in CURRENT.md (optional prod batch smoke, first-boot egress verdict, advisories closing on the main rescan, #2656); carried beta.238/237 watches in CURRENT.md.
- **🧑‍💻 Owner to-do** (carried): the beta.235 smoke checklist in CURRENT.md; the TASK-1039 second read day at N=3, then N back to 10 on Emily and Lilith; TASK-907 commitment-facts review; TASK-1048 break-it pass; TASK-104 voice-reference trims; #2656 merge approval (main-targeted dependabot PR).
- **Owner decisions**: TASK-1262 (no rush). TASK-1284 ruled ANNOTATE 2026-10-25 (now state:ready).
- **Explicitly NOT in**: the doc-112 TUI/headless CLI (idea; widened 2026-10-25, not scheduled) · the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913) · caching Phase 3 until the doc-17 reading · doc-107.
- **Deploy notes**: no migrations planned. If one lands, `release:premigrate --force` is classifier-denied to the agent, so the owner runs it as a `!` line. Expect the rebase-merge to refuse above ~117 commits; the fast-forward fallback is the path. After #2656 merges: `pnpm ops release:finalize`, rebase open PRs (dependabot PRs via `@dependabot rebase`), mark TASK-1233 Done. A push touching discord.js-adjacent files runs `pnpm ops surface:inventory --write` first. #2660 (security overrides, merged): release notes describe fast-uri as "back on the 3.x line ajv declares", not a bump; the `fast-uri@>=4.0.0 <4.2.3` entry is a forward guard that matches nothing today; after the cut, confirm the 10 open Dependabot alerts close (`pnpm ops security:advisories`). Driver eval Mon 10-26 / Tue 10-27: Tuesday morning the session idles clean for the owner's `/model sonnet` + `/advisor opus`.
- **Cut when**: TASK-1255 and TASK-1256 land (the family closes), or the backstops (~10 runtime PRs / ~250 files) fire first; run `pnpm ops release:range` for current values.
- **vNext+1 sketch**: TASK-1291 + TASK-1280 (the batch residue pass) or caching Phase 3, whichever gate opens first.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). Machloket e2e theme seeded 10-24 (`doc-114`): the harness against Machloket dev A/B is the parity test surface; scope after the 1252..1256 drain batch; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

