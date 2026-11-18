## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.246 (theme: prompt-cache prefix fix + its follow-ups, and the open prod-correctness fixes)

_Drafted 2026-11-16 after beta.245 (shipped 11-13, main `b33a7b7b7`). Scope per Lila 11-16: "the newly filed tasks included in the prod release, along with any other higher priority stuff that should go out soon" — this deliberately widens the ~2-3 runtime-PR close-the-train size to ~7; backstops (~10 runtime / ~250 files) still stand._

- **In already**: #2755 TASK-1425 cache breakpoints on the last stable message (dev acceptance passed: hit ratio 0.69, 1h TTL held across 410 s).
- **Merged into the train**: TASK-1422 (#2756), TASK-1418 (#2757), TASK-1428 (#2758), TASK-1427 (#2759), TASK-1426 + TASK-1421 (#2760), TASK-1432 (#2762), TASK-1429 (#2761), TASK-1441 (#2763), TASK-1440 (#2764), TASK-1446 (#2767); dev-deps group (#2766, recreated from #2753).
- **Waiting on**: nothing but the item below.
- **Dropped 11-16 (her pick)**: TASK-1374 closed obsolete (no live path reads a cached key-bound failure; prod 10-23..11-16: 568 rate_limit stores, 0 short-TTL skips); split into TASK-1433 (medium, revoked z.ai key retried per image) and TASK-1434 (low, dead writes + test-only default), neither in this train.
- **Explicitly NOT in**: TASK-1411 (close-the-train enforcement — tooling, its own PR) · TASK-1416 (low, detection consolidation) · TASK-1415 (observable) · tooling-only highs TASK-598/1387/1389 (non-runtime, ship any time) · TASK-1039/1346/671 (owner-gated or design-sized) · caching Phase 3 (doc-17 reading).
- **Before the cut**: the Dependabot production group, recreated as #2765 (from #2752; astro 7.4.4 → 7.4.11, closes alerts #201/#202), is red on `unit-tests (packages)`: `astro check` crashes because pnpm resolves `@emnapi/runtime@2.0.0-beta.2` as a peer while `@emnapi/core` stays 1.11.3. Fix with a `pnpm.overrides` pin to 1.11.3, then merge.
- **Deploy notes**: no migrations planned (re-check at cut). Release-notes line for TASK-1440 (Lila 11-18 AUQ "Keep images"): a bare link's preview image now goes to vision on the first reply, so every message with an unfurled link costs one more vision call; the trigger is also refetched from Discord's REST API (force: true), one extra GET per non-weigh-in trigger. Prod acceptance for TASK-1440: a bare-link trigger renders its embed on the FIRST reply. Prod acceptance for #2755: a same-model turn pair on an Anthropic-family model shows `cachedPromptTokens` ≈ prompt minus the per-turn block, with a small `cachedWriteTokens` (prod example before: 98,487 prompt / 10,365 cached / 88,118 written every turn).
- **Cut when**: every waiting-on unit is merged to develop; the release PR merge needs her explicit yes.
- **vNext+1 sketch (beta.247)**: FIRST: doc-66 burst coalescing, "latest wins" per (channel, personality) (Lila 11-18 AUQ: first unit of beta.247, not this train) · TASK-1411 enforcement · TASK-1416 · doc-17 reading → caching Phase 3.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

