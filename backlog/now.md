## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

- 🐛 `[FIX]` ~~**"Deleted" memories are still retrievable by the AI**~~ ✅ **FIXED on develop 2026-07-05 (#1490)** — visibility guard in the RAG similarity query + sibling expansion, re-embed-on-edit rider (atomic transaction). Ships to prod with the next release; remove this entry at ship time.

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Next pulls: job-payload contract suite (test-quality theme's founding motivation) · CPD campaign 1 (council-first) · legacy-column Phase A DROP (destructive; premigrate `--allow-destructive` at its release).

**✨ `[FEAT]` ~~Boulder design pass~~ ✅ **COMPLETE 2026-07-05 — all four, two days early.** Five accepted artifacts in `docs/proposals/backlog/`: `ux-design-system-spec` + `platform-portable-ux-design` (#1), `prompt-assembly-architecture` (#2), `memory-architecture` (#3), `agentic-scaffolding` (#4) — each 3-6-source grounded, full-trio-council passed, all decisions owner-signed. Theme files rewritten to implement the artifacts. Implementation phases are now the queue (each phase: plan-mode + council at build time). The struck agenda below stays one cycle as the artifact index:

  1. ~~**Design system / platform-portable UX layer**~~ ✅ **DONE 2026-07-04 (both parts)** — the normative design system [`ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) (tokens/components/command-grammar/discoverability; 6-agent grounding total, full-trio council, all 21 decisions adopted) + its machinery plan [`platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md). Absorbed commitments discharged into the phases.
  2. ~~**Prompt-assembly architecture**~~ ✅ **DONE 2026-07-05** — design ACCEPTED: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../docs/proposals/backlog/prompt-assembly-architecture.md) (4-agent grounding incl. first-party provider-fact verification; trio council; all calls decided; o-series rewrite deleted-not-fixed after fact-check; LangGraph adoption gate passed by construction). Boulders #3/#4 conform to its message shape.
  3. ~~**Memory architecture adjudication**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/memory-architecture.md`](../docs/proposals/backlog/memory-architecture.md) (verdict: evolve in-house w/ paradigm imports; 5-source grounding incl. owner's links + scoping model; trio council; eval harness + cost guardrails + strict opt-in community pools; phases 0+1a+2 = minimum-viable bet). Surfaced a prod bug en route (deleted memories retrievable — filed above). Theme file rewritten to implement the artifact.
  4. ~~**Agentic scaffolding**~~ ✅ **DONE 2026-07-05** — ACCEPTED: [`docs/proposals/backlog/agentic-scaffolding.md`](../docs/proposals/backlog/agentic-scaffolding.md) (the LangChain deep-dive the owner directed: hand-roll adjudicated over createAgent with named re-open triggers; provider seam confirmed THIN — no abstraction, three shims; v1: recall_memories → web_search → generate_image; council caught a wire-contract bug in the draft's cap-out path — fixed as the final-turn protocol).

**Below the fold — PROMOTED to next design slot (user 2026-07-05: "production bugs then config cascade design"): config-cascade semantics** — resolver priority, off-vs-inherit sentinel semantics, profiles-vs-presets; 5+ parked items defer to it (preset-cascade theme is the anchor). **NEW required dimension (user directive 2026-07-05): server/community as a config tier** — per-server settings don't exist at all today and should; the cascade design must place a GUILD tier in the resolution order (hardcoded → global/admin → guild → user → user×personality, exact placement is the design's call). Rhymes with the memory design's community pool + the 2025-12 proposal's ADR-002 scope enum (rejected then for lack of need — the need now exists in two designs).

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the Stryker pilot arc (config-resolver ratchet at 87.81 + CI `mutation-tests` job; suite-wide expansion still open), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- 🐛 `[FIX]` ~~**Settings-dashboard handler Map leaks closures on native dismiss**~~ ✅ fix in flight (fix/settings-session-handler-leak): the Map was write-only dead weight — handlers are rebuilt per-interaction; Map + `getUpdateHandler` + dead params deleted outright. Unblocks design-system spec D18 (Close-button removal). Remove at merge.

- ✨ `[FEAT]` **Codify the boulder-design process as a skill + re-sweep the mined corpus for OTHER repeatable-skill candidates** — User 2026-07-05 ("we should definitely codify as a skill… revisit that [mined-corpus summary] and identify any other repeatable skills"). Two parts: (a) write `tzurot-design-boulder` SKILL.md distilling the 4-session process that just worked (ground via parallel agents incl. first-party fact-verification of ALL provider/library claims → draft artifact with decision table → full-trio council per the council skill roster → owner decision pass → land with theme/backlog wiring + absorption map); (b) re-read `~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/` summary with a NEW-skill lens (the 2026-07-03 sweep was improvement-focused on existing rules/skills, not skill-gap discovery) and list candidates. Skills are review-gated (.claude/skills → PR). Surfaced 2026-07-05.

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
