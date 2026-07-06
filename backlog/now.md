## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Legacy-column retirement CLOSED 2026-07-05 (#1499 + #1501). Next pulls: job-payload contract suite (test-quality theme's founding motivation) · CPD campaign 1 (council-first).

**✨ `[FEAT]` ~~Boulder design pass~~ ✅ **COMPLETE 2026-07-05 — all four, two days early.** Five accepted artifacts in `docs/proposals/backlog/`: `ux-design-system-spec` + `platform-portable-ux-design` (#1), `prompt-assembly-architecture` (#2), `memory-architecture` (#3), `agentic-scaffolding` (#4) — each 3-6-source grounded, full-trio-council passed, all decisions owner-signed. Theme files rewritten to implement the artifacts. Implementation phases are now the queue (each phase: plan-mode + council at build time). The struck agenda below stays one cycle as the artifact index:

  1. ~~**Design system / platform-portable UX layer**~~ ✅ **DONE 2026-07-04 (both parts)** — the normative design system [`ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) (tokens/components/command-grammar/discoverability; 6-agent grounding total, full-trio council, all 21 decisions adopted) + its machinery plan [`platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md). Absorbed commitments discharged into the phases.
  2. ~~**Prompt-assembly architecture**~~ ✅ **DONE 2026-07-05** — design ACCEPTED: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../docs/proposals/backlog/prompt-assembly-architecture.md) (4-agent grounding incl. first-party provider-fact verification; trio council; all calls decided; o-series rewrite deleted-not-fixed after fact-check; LangGraph adoption gate passed by construction). Boulders #3/#4 conform to its message shape.
  3. ~~**Memory architecture adjudication**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/memory-architecture.md`](../docs/proposals/backlog/memory-architecture.md) (verdict: evolve in-house w/ paradigm imports; 5-source grounding incl. owner's links + scoping model; trio council; eval harness + cost guardrails + strict opt-in community pools; phases 0+1a+2 = minimum-viable bet). Surfaced a prod bug en route (deleted memories retrievable — filed above). Theme file rewritten to implement the artifact.
  4. ~~**Agentic scaffolding**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/agentic-scaffolding.md`](../docs/proposals/backlog/agentic-scaffolding.md) (the LangChain deep-dive the owner directed: hand-roll adjudicated over createAgent with named re-open triggers; provider seam confirmed THIN — no abstraction, three shims; v1: recall_memories → web_search → generate_image; council caught a wire-contract bug in the draft's cap-out path — fixed as the final-turn protocol).

**~~Config-cascade semantics~~ ✅ DESIGN DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/config-cascade-semantics.md`](../docs/proposals/backlog/config-cascade-semantics.md) (guild tier: personality → GUILD → channel via new GuildSettings + `/server settings`; sentinel fix: absence=inherit + stored-null-as-OFF with registry/wire-contract/pinned-default; priority kept user>personality; profiles layer-never-replace; clamps trigger-deferred; trio council unanimous, all riders folded). Phase 0 fixes the live maxAge off-vs-inherit bug + the RouteDeps detached-resolver footgun.

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the Stryker pilot arc (config-resolver ratchet at 87.81 + CI `mutation-tests` job; suite-wide expansion still open), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- 🏗️ `[LIFT]` **Real-scale eval goldens → unpark hybrid retrieval** — the Phase 1a resume gate (full context: `cold/themes/memory-system-overhaul.md` § Phase 1a status). Build goldens from REAL prod memory data at real corpus scale (hundreds of rows/persona, where dense dilution actually bites), re-run the dense-vs-hybrid A/B, then merge `feat/memory-hybrid-retrieval` on demonstrated lift or delete it on a second null. **Design constraint to settle first**: the repo is PUBLIC — raw prod memories cannot land in the committed goldens file; needs a gitignored local fixture (eval skips if absent) or anonymized derivation, owner call. Owner involvement wanted for realistic query construction. ~2hr + the owner session. Parked branch rots mechanically as develop moves — rebase it when resuming. Filed 2026-07-06.

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
