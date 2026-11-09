## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.243 (theme: owner-queue copy fixes plus the dependency catch-up; a sketch, not yet a commitment)

_Drafted at the beta.242 cut (2026-11-03). beta.242 shipped 33 PRs / 18 runtime / 238 files (#2711; GitHub refused the rebase-merge at 139 commits, main fast-forwarded to develop): bot-client hardening (deny list, multi-tag NSFW, catalog alerts, hostile model ids, refused webhook names), BYOK rotation tooling, and the local Machloket e2e tier._

- **In already**: the Dependabot groups, both recreated after ignoring rebase requests: #2712 (production, 11 updates incl. discord.js 14.28, plus a command-snapshot refresh for its new `file_types` key) and #2713 (development, 12).
- **Waiting on**: the owner copy rulings: TASK-1306 (restore confirm buttons after a refused batch confirm; rec yes), TASK-1309 (facts expiry copy via the catalog; rec yes), TASK-1303 (deny fetch-failure copy), TASK-1294 (deny cap copy; rec yes). The minimatch advisory (alerts 197/199) is fixed on develop by #2727 (import-x 4.18.0 + an override to 11.0.5). The alert closes when this release reaches `main`, Dependabot's default branch; check `pnpm ops security:advisories` after the merge (TASK-1371). Carried: TASK-705 phase 2 + the `debug:` removal of #2601's capture (watch-gated on prod `guildInfoAmbiguousRoles`), TASK-1137 (joint Spacebar/Machloket boot; needs Lila + the Machloket client session), TASK-1153, TASK-1150/1151, TASK-1197.
- **Watches**: the beta.242 set in CURRENT.md (#2689 stored summaries, #2690 one NSFW prompt per message, #2710 refused webhook names, #2702 the OpenRouter 403); carried beta.241 and older sets in CURRENT.md.
- **🧑‍💻 Owner to-do** (carried): the beta.235 smoke checklist in CURRENT.md; the TASK-1039 second read day at N=3, then N back to 10 on Emily and Lilith; TASK-907 commitment-facts review; TASK-1048 break-it pass; TASK-104 voice-reference trims; #2699 (claude-code-action bump targeting main, needs her yes).
- **Owner decisions**: TASK-1262 (no rush) and the copy rulings above.
- **Explicitly NOT in**: the doc-112 TUI/headless CLI (idea, not scheduled) · the memory-archive flips (settings, not code) · browse/UI waves 4–6 · doc-86 · the vitest 5 bump (TASK-913) · caching Phase 3 until the doc-17 reading · doc-107.
- **Deploy notes**: no migrations planned. If one lands, `release:premigrate --force` is classifier-denied to the agent, so the owner runs it as a `!` line. The rebase-merge refused at 139 commits at the beta.242 cut; the fast-forward fallback (after the merge gate fires) worked, and finalize was then a no-op. A push touching discord.js-adjacent files runs `pnpm ops surface:inventory --write` first. Preflight: `guard:repo-settings` must read clean before any release PR opens. The archive-summary prompt-version bump and re-sweep, held until #2689 reached prod, are unblocked once the beta.242 deploy is confirmed. Deploy skew from #2718: `ListDenylistResponseSchema.truncated` is required, so a new bot-client against the old api-gateway fails every `/deny browse`/`view`/batch read until api-gateway is up (owner-only, self-heals); old client + new gateway is fine. Name it in the release notes. Privacy-policy change (#2725, TASK-283, the erasure-scope disclosure): the policy promises material changes are announced through the release-notes channel, so the notes carry one line on it.
- **Cut when**: the copy rulings and the dependency catch-up have landed, or the standing backstops fire first (~10 runtime PRs / ~250 files from `pnpm ops release:range`; 0 / 0 at the cut).
- **vNext+1 sketch**: caching Phase 3 (after the doc-17 reading); the doc-114 Machloket e2e assertions.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

