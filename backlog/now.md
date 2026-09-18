## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._


- 🐛 `[FIX]` **Vision chain terminates on a router `content_policy` refusal, so the Qwen tail is never reached** (owner report 2026-09-12; log-verified on the current prod ai-worker deployment: 67 vision invocations in ~11.7 h, ZERO on `qwen/qwen3.5-397b-a17b`; two sensitive images walked glm-flash `provider_content_refused` → advance → `openrouter/auto` `content_policy` → "terminate category, image itself rejected", then negative-cached so two re-asks terminated without a call). Mechanism: `VISION_TERMINATE_CATEGORIES` holds `content_policy` and `censored`, treating a provider's refusal as image-intrinsic, against TASK-747's recorded evidence that lower tiers describe what an upstream filter refused. **TASK-937 (high, S). Owner ruling 2026-09-12: both refusal kinds advance; only `media_not_found` stays terminal.** **Fix MERGED as #2399 (develop `3abdc6ad6`, 2026-09-12; ships with beta.223)**: the terminate set is `media_not_found` only, pinned by the invariant tests, single-hop advance tests for both refusal kinds, the three-hop prod walk, and a real-Redis test where a cached `content_policy` entry on tier 1 advances to a fresh tier-2 call. The two prod images already negative-cached at the router advance on their next ask without a flush (the cache is per model). TASK-899 (a less-filtered tail model) stays separate. **Runtime-UNVERIFIED until the deploy** — remove this entry when a prod log shows a qwen invocation following an auto-router `content_policy` advance (TASK-937 stays open as `state:observable` for that clause).

- **Runtime-unverified fixes and parked incidents moved to `state:observable` tracker tasks (2026-09-13 context-budget trim)**: TASK-952 (#2253 single-job restart recovery) · TASK-953 (#2155 guest floor hop-1 promotion) · TASK-954 (PARKED reply-ping toggle; branch `fix/reply-ping-gate` stays, never merge on the code read) · TASK-955 (#2220 GLM catalog-veto rescue) · TASK-956 (the 2026-07-12 Postgres lock-timeout window; probe DURING the next one). Each carries its watch signal; close the task on the observation.


---



### 🚢 Next Release — beta.227 (theme: the digest's prod rollout read and its data-rights closeout, then the drain)

_beta.226 CUT 2026-09-18 (8 PRs / 8 runtime / 155 range files, 175 in the PR diff with the cut commits; two additive migrations premigrated to prod; PR #2450 `0f1e9cfbc`; finalize done; tagged `latest`). The whole doc-97 Phase 4 build: slice 0 (#2442), 1a (#2444), 1b (#2445), 2 (#2446), the stamp fix (#2447), the dry run + warn line (#2448), the single-quote stripper (#2449), the register telemetry (#2443); riders: the privacy retention row, TASK-1013/1014. **A plan-driven cut on the owner's ruling; neither backstop fired.**_

- **Driver**: Fable, nested dispatch per `/tzurot-orchestration`. Owner decisions carried (binding): the Emily flip carries to prod (ruled 2026-09-18); the memory-archive flips stay per character on their gates; the owner clears sessions with `/clear`, so every handoff lives on disk.
- **In**: _(empty at cut time)_.
- **Waiting on**: (1) the prod rollout read — the owner's flips (`CURRENT.md` resume point), then agent-run `digest:refresh --env prod`, the tick, and one fresh TASK-949 trace (to beat ~4.4k completion tokens / 72 s); (2) TASK-1013 (stale digest rows swept) and TASK-1014 (digests in the account export) — high, size S, both `state:ready`; (3) the doc-61 economy pass over `.claude/rules` and `CURRENT.md` (`/tzurot-doc-audit` § 3b, ends with `cadence:mark economy-pass`); (4) the medium/S drain in same-area batches of 3–5 (TASK-958, 959, 968, 969, 960–962).
- **Watches (agent-run, no owner action)**: the beta.226 watch list in `CURRENT.md`; TASK-991/992's runtime clause; the doc-17 caching reading; TASK-937; TASK-947 (`adm-zip`, no fix upstream); TASK-901; the Emily pre-warm gate and dead-row read.
- **🧑‍💻 Owner to-do**: (1) ~~the prod flips~~ DONE 2026-09-18 ~13:55Z (both Emily pairs due at the read, the tick awaited); (2) TASK-907: review the commitment facts via `/memory facts`, Sort A-Z, the `{assistant}` block at one end; note any welcomed pet name NOT extracted (TASK-950); (3) TASK-104: trim and re-upload the 8 over-cap voice references, then `pnpm ops voice-refs:audit --env prod`; (4) ~~the archive/digest consolidation idea doc~~ FILED as `doc-107` 2026-09-18 (owner asked); (5) leisure, unchanged: card-level examples for Emily; the voice-harness blind review.
- **Explicitly NOT in**: the memory-archive flips themselves (settings, not code) · browse/UI (`doc-14`, incl. the `/shapes export` UX row) · `doc-86` · TASK-906/TASK-910 residue unless a prompt-version bump is planned · the vitest 5 bump (TASK-913 watches) · further lookahead on the strip matchers (TASK-921/923, TASK-1012) · TASK-933 · the agentic `/memory remember` (the agentic proposal owns it) · a digest prompt-version bump (nothing observed warrants one).
- **Deploy notes**: no migrations pending at the write; TASK-1013's sweep is code only. The digest sweep on prod is OFF until the owner's flip; spend ceiling once on = listed pairs × ≤12/day (D8). The reminder DM (beta.223) forms its first prod cohort on or after 2026-10-04; retention is live and autonomous from beta.222 (kill switch: `RETENTION_AUTORUN_ENABLED=false` on bot-client). Prod ops writes under auto mode: `release:premigrate` and `db:safe-migrate` are `autoMode.soft_deny` at user scope by design; `release:premigrate` now also carries a `permissions.ask` rule, so it prompts (forwarded to the phone) instead of reaching the classifier.
- **Cut when**: TASK-1013 + TASK-1014 have shipped and the prod rollout read is recorded, OR the ~10 runtime-PR / ~250-file backstop fires first (`release:range` at this cut: 0 PRs / 0 files); say which at the cut.
- **🗺️ Horizon (rolling three releases, re-touched at every cut)**:
  - **beta.227** — this block.
  - **beta.228** — caching Phase 3 if the doc-17 reading arrives; the remaining characters' archive flips as their gates read READY; slice C's dead-row report; the UX-epic slice (`doc-14` waves 4–6); the archive/digest consolidation pass (`doc-107`) once the digest shape has settled.
  - **Backlog slope**: the 226 window (2026-09-16 cut → 2026-09-18 cut) closed five tasks through its eight PRs (994, 996, 1006, 1007, 1008) and filed up to TASK-1014 from TASK-997 (≤18) — net about +13 on the pool in a two-day window that opened and closed one defect class; re-measure at the next cut.

### 🎯 Current Focus (max 3)

**🐛 `[FIX]` Character voice drift in long conversations — `doc-97` (owner intake 2026-09-05, HIGH; the beta.219 opener and the re-entry into `doc-8`)** — a character's replies no longer match its card after months of use. Measured from prod memories on 2026-09-05 (aggregates only, read-only one-off script stored under `docs/local/handoffs/`, copied into `scripts/analysis/` to run): the card register faded through spring and collapsed in August 2026 — exclamation marks per 1k chars 1.3–3.8 (winter) → 0.7–1.0 (Apr–Jul) → 0.06 (Aug) → 0.01 (Sep); a courtroom vocabulary absent through July appears in August and doubles in September; average reply length 830 → 1,652 chars. Mechanism: the card sits ~45k tokens upstream behind the cache prefix while ~43k tokens of the character's own prose (cross-channel history + memory archive, which stores replies verbatim) sit at the generation point. Phase 1 (the `voice_anchor` V-tier section) shipped in beta.219 (#2348), and every build phase of the memory-archive design (`doc-8`) is on main behind switches that ship OFF; what remains is Phase 2 (the owner-applied directive) and the owner-run rollout in `CURRENT.md`. Owner rulings 2026-09-05: anchor before caching Phase 2, LID starts at the design pass. Evidence, handoff, and payload under `docs/local/handoffs/` (gitignored).

**🧹 `[LIFT]` Follow-Up Pool Drain — standing background (RESUMED 2026-08-16: doc-77 shipped in beta.203)** — tracker `doc-7`: the outflow campaign over the ~321-task pool. Opening surfaces: `pnpm tracker task list -s "To Do" -l size:S --priority high --plain` (then medium), the digest's oldest-20, and doc-7's Phase-1 domain batches (~13 clusters + scattered singletons, counts in the doc). Boundary reminder: **rule-outs are owner-gated, fail-closed** — the agent ships work and verifies-obsolete by grep; merit-removals surface to the owner (06-backlog § Ruling an item out). Substrate migration COMPLETE (#1822 import · #1823 flip · labeling pass · #1825 themes/ideas→docs); design record: [`docs/proposals/backlog/backlog-substrate.md`](../docs/proposals/backlog/backlog-substrate.md).

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(2026-09-16: the Dependabot batch + claude-workflow main-cut entry SHIPPED in beta.225 — `claude-code-action@v1.0.222` on both `main` and `develop`, #2424 merged, #2425/#2426 superseded by #2430/#2431; the one open alert, 159 `adm-zip`, is TASK-947's watch. Quick Wins is empty.)_



### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — a tracker task (`pnpm tracker task create`, terse one-liner), a tracker idea doc (`pnpm tracker doc create`, speculative feature), a theme doc + `cold/queue.md` bullet (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(2026-07-17: the prod facts-quality feedback item routed to tracker `doc-8` § design inputs — it's 1b acceptance criteria for the parked memory epic. 2026-08-23: the slash-chat-mirrors-tagging directive routed to idea doc `doc-82` — Untriaged is empty.)_

