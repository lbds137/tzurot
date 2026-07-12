## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

- 🐛 `[FIX]` **Prod Postgres lock timeouts, 15:24–16:32 UTC 2026-07-12** — recurring `canceling statement due to lock timeout` on gateway writes: ≥6 conversation-history persists failed fail-soft (replies delivered, history rows missing) and a character import timed out at 16:29 (succeeded on 16:35/16:37 retries). NOT db-sync (last completed 14:37), NOT retention (no runs logged). Probe ran (owner-approved, ~17:55 UTC): **no live contention, no in-transaction sessions** — the holder released before observation and is now unidentifiable. Structural finding: server-level `idle_in_transaction_session_timeout=0` (and `lock_timeout=0`/`statement_timeout=0`) — a wedged idle-in-transaction connection can hold locks indefinitely; only our app-pool timeouts contained the damage. Mitigation SHIPPED (#1606, on develop — reaches prod at next release): main-pool `idle_in_transaction_session_timeout=60s` reaps app-held wedged transactions. Holder identity remains unknown; an EXTERNAL wedged session (DB console) is out of the guard's reach — DB-level `ALTER DATABASE` is the escalation if it recurs post-release. Next occurrence: run the `pg_stat_activity`/`pg_blocking_pids` probe DURING the window (one-off script per the session's `lock-probe.ts`). Filed 2026-07-12.

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Legacy-column retirement CLOSED 2026-07-05 (#1499 + #1501); test-quality theme CLOSED 2026-07-06 (all four candidates — contract suite + five-package Stryker ratchet + Pact rule-out + invariants audit). CPD theme CLOSED 2026-07-06 (all four campaigns, #1517–#1521). Knockout is down to trigger-gated stragglers (PGLite 2–3, z.ai samples) — the next-epic pick from cold/queue.md is the open conversation. Next pulls meanwhile: agentic scaffolding build (prerequisite discharged) · real-scale goldens session (unparks memory 1a) · config-cascade Phase 0 (build-ready design).

**✨ `[FEAT]` ~~Boulder design pass~~ ✅ **COMPLETE 2026-07-05 — all four, two days early.** Five accepted artifacts in `docs/proposals/backlog/`: `ux-design-system-spec` + `platform-portable-ux-design` (#1), `prompt-assembly-architecture` (#2), `memory-architecture` (#3), `agentic-scaffolding` (#4) — each 3-6-source grounded, full-trio-council passed, all decisions owner-signed. Theme files rewritten to implement the artifacts. Implementation phases are now the queue (each phase: plan-mode + council at build time). The struck agenda below stays one cycle as the artifact index:

  1. ~~**Design system / platform-portable UX layer**~~ ✅ **DONE 2026-07-04 (both parts)** — the normative design system [`ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) (tokens/components/command-grammar/discoverability; 6-agent grounding total, full-trio council, all 21 decisions adopted) + its machinery plan [`platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md). Absorbed commitments discharged into the phases.
  2. ~~**Prompt-assembly architecture**~~ ✅ **DONE 2026-07-05** — design ACCEPTED: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../docs/proposals/backlog/prompt-assembly-architecture.md) (4-agent grounding incl. first-party provider-fact verification; trio council; all calls decided; o-series rewrite deleted-not-fixed after fact-check; LangGraph adoption gate passed by construction). Boulders #3/#4 conform to its message shape.
  3. ~~**Memory architecture adjudication**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/memory-architecture.md`](../docs/proposals/backlog/memory-architecture.md) (verdict: evolve in-house w/ paradigm imports; 5-source grounding incl. owner's links + scoping model; trio council; eval harness + cost guardrails + strict opt-in community pools; phases 0+1a+2 = minimum-viable bet). Surfaced a prod bug en route (deleted memories retrievable — filed above). Theme file rewritten to implement the artifact.
  4. ~~**Agentic scaffolding**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/agentic-scaffolding.md`](../docs/proposals/backlog/agentic-scaffolding.md) (the LangChain deep-dive the owner directed: hand-roll adjudicated over createAgent with named re-open triggers; provider seam confirmed THIN — no abstraction, three shims; v1: recall_memories → web_search → generate_image; council caught a wire-contract bug in the draft's cap-out path — fixed as the final-turn protocol).

**~~Config-cascade semantics~~ ✅ DESIGN DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/config-cascade-semantics.md`](../docs/proposals/backlog/config-cascade-semantics.md) (guild tier: personality → GUILD → channel via new GuildSettings + `/server settings`; sentinel fix: absence=inherit + stored-null-as-OFF with registry/wire-contract/pinned-default; priority kept user>personality; profiles layer-never-replace; clamps trigger-deferred; trio council unanimous, all riders folded). Phase 0 fixes the live maxAge off-vs-inherit bug + the RouteDeps detached-resolver footgun.

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the Stryker pilot arc (config-resolver ratchet at 87.81 + CI `mutation-tests` job; suite-wide expansion still open), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- 🏗️ `[LIFT]` **Retrieval eval — 1c is an HONEST RE-BASELINE (the fold already ships; 2026-07-12 correction)** — the Phase-1a resume gate (full context: `active-epic.md` §§ 1a/1c; plan `.claude/plans/mutable-doodling-thunder.md`, approved). Corpus mined LOCAL-ONLY (Lila, dev; committed = the #1608 miner + the #1609 pooling/scoring instrument, merged to develop). **Grounding correction**: context-folding (last 3 turns prepended via `extractRecentHistoryWindow`+`buildSearchQuery`) ALREADY SHIPS and feeds both arms — the A/B's "6/20 (30%) both-arms-miss" measured the BARE message (`goldensPooling.eval.test.ts:154`), which prod doesn't do. **We have never measured the real production baseline.** Owner-decided: re-baseline honestly first, mining real Lila turns from dev `ConversationHistory` (synced from prod, 30-day window) → reconstruct the exact folded query offline → paired bare-vs-folded A/B (+ turn sweep) with a non-circularity guard. 4 slices: PR-1 turn-count param (prod), PR-2 conversation-goldens miner (local), PR-3 fold-aware runner + dedup fix (local), PR-4 scoring extensions (mixed). Residual both-miss AFTER folding decides rung-2 (LLM rewrite). `feat/memory-hybrid-retrieval` STAYS PARKED as FTS-index input. Filed 2026-07-06; re-baseline in progress 2026-07-12.

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

