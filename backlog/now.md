## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- **Runtime-unverified fixes and parked incidents live as `state:observable` tracker tasks**: TASK-937 (#2399 vision refusal advance, shipped beta.223; closes on a prod log of a qwen call after an auto-router `content_policy` advance) · TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.

---

### 🚢 Next Release — beta.244 (theme: prompt caching on the OpenRouter/Anthropic path + the preset temperature fix; a deliberately small train)

_Drafted at the beta.243 cut (2026-11-12). beta.243 shipped 32 PRs / 21 runtime / 296 files (#2745; rebase-merge refused at ~139+ commits, main fast-forwarded to develop `be0e8a5ca`, finalize no-op, tagged latest, beta.242 demoted). Smoke batch: 2 needs-smoke + 4 carried, in CURRENT.md's beta.243 watch._

- **In already**: (empty — the train opens with the caching unit)
- **Waiting on**: the OpenRouter/Anthropic prompt-caching fix — `cache_control` as the fourth OpenRouterExtraParams key riding `injectOpenRouterParams` (ModelFactory/OpenRouterFetch seam, proven), gated on anthropic-family model ids, TTL=1h (her pick; 2x writes / 0.1x reads), write-side usage observability added — plus TASK-1408 (preset temperature-clear: the gateway REPLACES `advancedParameters` wholesale at `LlmConfigService.ts:362-363`; fix is bot-client-only, ~10-15 lines; remaining read = what the dashboard modal submits).
- **Explicitly NOT in**: TASK-1374 (vision negative-cache key-scoping — first follow-up after beta.243 soaks; holistic review named it) · TASK-1411 (close-the-train enforcement — her ruling 11-12; lands as its own tooling/skill PR, not a release rider) · per-preset TTL (needs ModelConfig + CacheKeyBuilder + schema + dashboard — a much bigger unit) · caching Phase 3 (still gated on the doc-17 reading).
- **Deploy notes**: no migrations planned. Caching changes routing posture: top-level `cache_control` is documented for Anthropic/Vertex/Azure/Bedrock providers only, hence the family gate; sticky routing pins a conversation to one provider for ~60 min (deliberate). First cached call should show write-side usage — that observability is part of the unit's acceptance.
- **Cut when**: both units land — the train should stay ~2-3 runtime PRs (the close-the-train working agreement applies from the first drafted notes); backstops stand (~10 runtime / ~250 files).
- **vNext+1 sketch**: TASK-1374 key-scoping · TASK-1411 enforcement · doc-17 reading → caching Phase 3.

### 🎯 Current Focus (max 3)

**🛰️ `[FEAT]` Transport Parity — Tzurot outside Discord (`doc-109`, the local design lane since 2026-09-30)** — Tzurot-side units: TASK-1137 joint boot (boot-b up; the interactive TR exercise is pending) → the conformance surface (TASK-1145 shipped). **Machloket e2e (`doc-114`, promoted 2026-11-01): next up after TASK-1331 and TASK-1332..1335.** First unit: send/receive, gateway events and slash commands against a throwaway server from the Machloket server's own e2e harness, run locally; mismatches route as findings. The fork itself (`doc-83`, Machloket Server) is another session's board. Detail: `active-epic.md` § ACTIVE THEME.

**🐛 `[FIX]` Character voice drift — `doc-97` / `doc-8` rollout (owner-run since 2026-09-24)** — every build slice is on main behind switches; the owner runs the flips per character in `CURRENT.md`. Agent-side remainder: TASK-1039 (Phase 4 first slice, after the owner's second read day). Evidence and the measured drift curve: `doc-97`.

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background** — tracker `doc-7`: the outflow campaign over the open task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).
### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

