## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

- 🐛 `[FIX]` **"Deleted" memories are still retrievable by the AI — retrieval SQL has no `visibility` filter** — All memory deletion paths (`/memory delete`, batch delete, typed-phrase `purge`) soft-delete via `visibility='deleted'`, but `PgvectorQueryBuilder.buildSimilaritySearchQuery` filters only persona/personality/timestamp/channel — never `visibility`. Consequence (code-confirmed missing filter; runtime repro pending): purged/deleted memories keep flowing into RAG prompts, silently violating the user's explicit deletion. **Fix shape**: add a visibility guard to the similarity query (+ decide semantics for `hidden`/`archived` — likely also excluded from RAG) + tests incl. a component test over PGLite; **rider in the same PR**: memory edit doesn't re-embed (`handleUpdateMemory` updates `content` only — search matches the old text; re-embed on edit). Surfaced 2026-07-05 (boulder-#3 current-impl grounding sweep). |

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Next pulls: job-payload contract suite (test-quality theme's founding motivation) · CPD campaign 1 (council-first) · legacy-column Phase A DROP (destructive; premigrate `--allow-destructive` at its release).

**✨ `[FEAT]` Boulder design pass — BEFORE 2026-07-07 (Fable→Opus handoff)** — User directive 2026-07-03: spend remaining strong-model days on design work for the hardest architecture. **Sweep DONE 2026-07-03** (report archived in mined-corpus): shortlist confirmed + ONE timing-critical addition. **Final agenda, in session order** (each → written design artifact + council pass; ordering is load-bearing):

  1. ~~**Design system / platform-portable UX layer**~~ ✅ **DONE 2026-07-04 (both parts)** — the normative design system [`ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) (tokens/components/command-grammar/discoverability; 6-agent grounding total, full-trio council, all 21 decisions adopted) + its machinery plan [`platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md). Absorbed commitments discharged into the phases.
  2. ~~**Prompt-assembly architecture**~~ ✅ **DONE 2026-07-05** — design ACCEPTED: [`docs/proposals/backlog/prompt-assembly-architecture.md`](../docs/proposals/backlog/prompt-assembly-architecture.md) (4-agent grounding incl. first-party provider-fact verification; trio council; all calls decided; o-series rewrite deleted-not-fixed after fact-check; LangGraph adoption gate passed by construction). Boulders #3/#4 conform to its message shape.
  3. **Memory architecture adjudication** (OpenMemory vs evolved-pgvector vs other; fresh upstream research REQUIRED first). MUST absorb: lore books ✓, message-actions history/memory consistency invariant, db-sync seed/deletion-propagation strategy; check `docs/proposals/backlog/MEMORY_MANAGEMENT_COMMANDS.md` for prior design work before re-deriving.
  4. **Agentic scaffolding** (tool loop; unlocks media gen + web tools + deep research; job-payload contract suite is the de-facto prerequisite build). Sketch the provider seam IF tool-calling proves provider-divergent (else provider abstraction stays gated on the 3rd-provider trigger). **Opens with deep upstream research on the LangChain team's current stack — LangGraph + their agent offerings (user directive 2026-07-05: "deeply investigate what the team behind LangChain has been cooking"); ai-worker already runs on LangChain, so adopting vs hand-rolling the loop is a real fork.** (Boulder #2 carries a light recon of LangGraph's expected message/state shape so the prompt-assembly design stays adoption-compatible.)

**Below the fold (next design window, not pre-handoff): config-cascade semantics** — resolver priority, off-vs-inherit sentinel semantics, profiles-vs-presets; 5+ parked items defer to it (preset-cascade theme is the anchor). Real boulder, no prod pressure.

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the Stryker pilot arc (config-resolver ratchet at 87.81 + CI `mutation-tests` job; suite-wide expansion still open), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- 🐛 `[FIX]` **Settings-dashboard handler Map leaks closures on native dismiss** — `SettingsSessionStorage.ts:15`'s in-memory `sessionMetadata` Map (non-serializable `updateHandler` per session) is deleted only via the explicit Close/`deleteSession` path; a native-dismissed settings/defaults dashboard strands its closure for the process lifetime (Redis half expires via TTL; the Map half never does). **Fix**: the handler is code, not state — resolve from a static registry keyed by `entityType`, delete the Map (TTLCache is the fallback shape if a registry doesn't fit). Also the precondition for removing Close buttons from settings dashboards (design-system spec D18). Surfaced 2026-07-04 (boulder #1 part-2 teardown investigation, owner-prompted).

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
