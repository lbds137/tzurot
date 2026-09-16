## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._


- 🐛 `[FIX]` **Vision chain terminates on a router `content_policy` refusal, so the Qwen tail is never reached** (owner report 2026-09-12; log-verified on the current prod ai-worker deployment: 67 vision invocations in ~11.7 h, ZERO on `qwen/qwen3.5-397b-a17b`; two sensitive images walked glm-flash `provider_content_refused` → advance → `openrouter/auto` `content_policy` → "terminate category, image itself rejected", then negative-cached so two re-asks terminated without a call). Mechanism: `VISION_TERMINATE_CATEGORIES` holds `content_policy` and `censored`, treating a provider's refusal as image-intrinsic, against TASK-747's recorded evidence that lower tiers describe what an upstream filter refused. **TASK-937 (high, S). Owner ruling 2026-09-12: both refusal kinds advance; only `media_not_found` stays terminal.** **Fix MERGED as #2399 (develop `3abdc6ad6`, 2026-09-12; ships with beta.223)**: the terminate set is `media_not_found` only, pinned by the invariant tests, single-hop advance tests for both refusal kinds, the three-hop prod walk, and a real-Redis test where a cached `content_policy` entry on tier 1 advances to a fresh tier-2 call. The two prod images already negative-cached at the router advance on their next ask without a flush (the cache is per model). TASK-899 (a less-filtered tail model) stays separate. **Runtime-UNVERIFIED until the deploy** — remove this entry when a prod log shows a qwen invocation following an auto-router `content_policy` advance (TASK-937 stays open as `state:observable` for that clause).

- **Runtime-unverified fixes and parked incidents moved to `state:observable` tracker tasks (2026-09-13 context-budget trim)**: TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.


---



### 🚢 Next Release — beta.226 (theme: doc-97 Phase 4 — the history-side design, then its build)

_beta.225 CUT 2026-09-16 (18 PRs / 12 runtime / 216 range files; no migrations; PR #2441 `eb09c14f9`; finalize done; tagged `latest`). The cross-persona memory leak closed in both halves (#2439 archive notes, #2440 facts), the whole timezone cluster (#2428/#2433/#2434) runtime-verified on dev before the cut, windowless secret rotation (#2427/#2422/#2421/#2432) with the dev rotation run clean, reserved fact slots (#2419), `/history clear` everywhere (#2420), the cadence ledger (#2436), the `.env.example` guard (#2435), the two-lens mining refit and its operationalization (#2437/#2438), three dependabot batches. **A plan-driven cut: every criterion shipped, and the ~10 runtime backstop fired independently at 12.**_

- **Driver**: Fable, nested dispatch per `/tzurot-orchestration`. Owner decisions carried (binding): cross-channel history stays ON for Emily until doc-97 Phase 4 lands; the memory-archive flips stay per character on their gates; the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In**: nothing yet.
- **Waiting on**: **the doc-97 Phase 4 design pass** (the continuity-feed premise; candidates in order — a category-indexed standing block → a recent-days digest → the agentic form deferred on the measured 14–72 s latency; the number to beat is ~4k reasoning tokens / 72 s per turn for register-holding) → its BUILD if the design lands small enough for one train · **the doc-61 economy pass** over `.claude/rules` and `CURRENT.md` (rules had 2,652 B of headroom and `CURRENT.md` 132 B before this cut's reset; procedure `/tzurot-doc-audit` § 3b, ending with `cadence:mark economy-pass`) · the medium/S drain in same-area batches of 3–5 (TASK-958, 959, 968, 969, 960–962).
- **Watches (agent-run, no owner action)**: TASK-991/992's runtime clause (the next shared-LTM debug export with a foreign note or fact); the doc-17 caching reading; TASK-937; TASK-947 (`adm-zip`, no fix upstream); TASK-901; the Emily pre-warm gate and dead-row read; the beta.225 watch list in `CURRENT.md`.
- **🧑‍💻 Owner to-do**: (1) ~~the PROD `INTERNAL_SERVICE_SECRET` rotation~~ DONE 2026-09-16 (stages 1→2→3 verified by boot lines, zero auth failures; detail in `CURRENT.md`); (2) TASK-907: review the commitment facts via `/memory facts`, Sort A-Z, the `{assistant}` block at one end; note any welcomed pet name NOT extracted (TASK-950); (3) TASK-104: trim and re-upload the 8 over-cap voice references, then `pnpm ops voice-refs:audit --env prod`; (4) leisure, unchanged: card-level examples for Emily; the voice-harness blind review.
- **Explicitly NOT in**: the memory-archive flips themselves (settings, not code) · browse/UI (`doc-14`, incl. the `/shapes export` UX row) · `doc-86` · TASK-906/TASK-910 residue unless a prompt-version bump is planned · the vitest 5 bump (TASK-913 watches) · further lookahead on the strip matchers (TASK-921/923) · TASK-933 · the agentic `/memory remember` (the agentic proposal owns it).
- **Deploy notes**: no migrations pending. The prod rotation is the one operational step and its ordering is not optional: stage 1 is safe only against a gateway RUNNING the dual-acceptance code, which prod has only from beta.225 — wait for the prod deploy, run the dry run, then stages 1→2→3, verifying each redeploy by a boot line dated after the stage. Prod refuses `--yes` by design (three interactive confirmations), and the granted permission rule is dev-scoped. The reminder DM (beta.223) forms its first prod cohort on or after 2026-10-04; retention is live and autonomous from beta.222 (kill switch: `RETENTION_AUTORUN_ENABLED=false` on bot-client).
- **Cut when**: the doc-97 Phase 4 design has landed and either its build or the economy pass has shipped, OR the ~10 runtime-PR / ~250-file backstop fires first (`release:range` at this cut: 0 PRs / 0 files); say which at the cut.
- **🗺️ Horizon (rolling three releases, re-touched at every cut)**:
  - **beta.226** — this block.
  - **beta.227** — caching Phase 3 if the doc-17 reading arrives; the remaining characters' archive flips as their gates read READY; slice C's dead-row report; the UX-epic slice (`doc-14` waves 4–6).
  - **Backlog slope**: the 225 window (2026-09-13 cut → 2026-09-16 cut) closed at least thirteen tasks through its eighteen PRs (951, 838, 963, 976, 982, 964, 966, 983, 985, 977, 991, 992, 974) and filed TASK-971–992 (22, incl. the 984/990 residue) — net about +9 on the pool in a window that opened a new defect class and closed it; re-measure at the next cut.

### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Character voice drift in long conversations — `doc-97` (owner intake 2026-09-05, HIGH; the beta.219 opener and the re-entry into `doc-8`)** — a character's replies no longer match its card after months of use. Measured from prod memories on 2026-09-05 (aggregates only, read-only one-off script stored under `docs/local/handoffs/`, copied into `scripts/analysis/` to run): the card register faded through spring and collapsed in August 2026 — exclamation marks per 1k chars 1.3–3.8 (winter) → 0.7–1.0 (Apr–Jul) → 0.06 (Aug) → 0.01 (Sep); a courtroom vocabulary absent through July appears in August and doubles in September; average reply length 830 → 1,652 chars. Mechanism: the card sits ~45k tokens upstream behind the cache prefix while ~43k tokens of the character's own prose (cross-channel history + memory archive, which stores replies verbatim) sit at the generation point. Phase 1 (the `voice_anchor` V-tier section) shipped in beta.219 (#2348), and every build phase of the memory-archive design (`doc-8`) is on main behind switches that ship OFF; what remains is Phase 2 (the owner-applied directive) and the owner-run rollout in `CURRENT.md`. Owner rulings 2026-09-05: anchor before caching Phase 2, LID starts at the design pass. Evidence, handoff, and payload under `docs/local/handoffs/` (gitignored).

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

**🧹 `[CHORE]` Dependabot batch + the claude-workflow main-cut (OWNER APPROVED 2026-09-14)** — owner agreed to merge the claude-workflow bump directly to `main` and run `release:finalize` to resync develop, and to address the rest of the dependabot queue. **#2423** (`anthropics/claude-code-action` 1.0.216→1.0.222) touches ONLY `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml` and was opened against `develop` — merging it there would silently disable claude-review on every PR until the next cut. Sequence, and the ORDER is load-bearing: (1) let PR #2427 merge first — `release:finalize` rewrites `develop`, which force-rebases every open feature branch, so doing it under an in-review PR costs a needless CI cycle; (2) cut a branch from `main`, cherry-pick #2423's two workflow hunks, PR against `main`, owner-approve the merge (main merges always need a per-merge ask); (3) `pnpm ops release:finalize` IMMEDIATELY after — main carrying the new workflow bytes while develop carries the old ones is the same skip-everything state, just inverted, so the gap between (2) and (3) must be minutes; (4) close #2423 as superseded; (5) then #2424 (ci.yml + weekly-audit.yml), #2425 (production deps), #2426 (dev deps) ride develop normally, rebasing each onto the resynced develop before merge. Also open: Dependabot alert 159, 1 moderate on the default branch — run `pnpm ops security:advisories` at the beta.225 security preflight to classify it (direct / transitive / direct+transitive) and ride any fix into the release.



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

