## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues



_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

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

- ✨ `[FEAT]` **Fair-share quota for the shared system OpenRouter free-tier key (external review item 1)** — one heavy free user can exhaust the shared key and starve the community; manifests as mystery outages before any metric. Owner-flagged "sooner rather than later" 2026-07-03; aging upward. Implement the OpenRouter half of the provider-agnostic mechanism in `docs/proposals/backlog/free-tier-zai-piggyback.md` § Quota fairness — do NOT gate on the z.ai piggyback; freshness-check the proposal first and stop+flag if stale. **ASKs ANSWERED 2026-07-07**: per-DAY window (OpenRouter-style free-usage quotas); limits counted per REQUEST; at-limit = friendly rejection + guidance to get their own API key with a link to the most-sensible OpenRouter page (quick research task: likely the keys page or the FAQ on free limits — verify before shipping). Acceptance: one heavy user can't exhaust the key; per-user accounting visible in logs. Filed 2026-07-07 (external Fable review brief).

- 💰 `[FEAT]` **Eval z.ai GLM (+ openrouter/free) as the extraction engine** — the knobs shipped (#1569: `EXTRACTION_MODEL`/`EXTRACTION_DAILY_LIMIT` env, usage_logs rows, X-Title split); the cost kill is moving extraction to the flat-rate z.ai plan. Run `pnpm eval:extraction` with `EXTRACTION_MODEL` overridden (50 goldens, pennies) vs the Haiku baseline (10.3% violation / 99.6% recall / 100% supersession). **Scope beyond the env flip (PR #1569 reviews)**: (a) `invokeExtractionModel` must thread a provider override — routing is `modelConfig.provider ?? AI_PROVIDER`, NOT inferred from model name; (b) the usage row hardcodes `provider: 'openrouter'` — derive from the actual provider or z.ai spend mislabels; (c) `appTitleSuffix` attribution is OpenRouter-only — accept or replicate; (d) add the single-attempt-by-design note to `logExtractionUsage` while in the file (vs AIJobProcessor's 3x retry — deliberate: background rows are individually low-stakes). MUST land before prod-enabling extraction.
- 🏗️ `[LIFT]` **Real-scale eval goldens → unpark hybrid retrieval** — the Phase 1a resume gate (full context: `active-epic.md` § Phase-1a park — the memory theme was promoted to Active Epic 2026-07-06). Build goldens from REAL prod memory data at real corpus scale (hundreds of rows/persona, where dense dilution actually bites), re-run the dense-vs-hybrid A/B, then merge `feat/memory-hybrid-retrieval` on demonstrated lift or delete it on a second null. **Design constraint to settle first**: the repo is PUBLIC — raw prod memories cannot land in the committed goldens file; needs a gitignored local fixture (eval skips if absent) or anonymized derivation, owner call. Owner involvement wanted for realistic query construction. ~2hr + the owner session. Parked branch rots mechanically as develop moves — rebase it when resuming. Filed 2026-07-06.

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

