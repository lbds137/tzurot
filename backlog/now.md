## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_(none active)_

_Recently resolved items move to the GitHub release notes at ship time — this section stays empty between incidents (history: git + releases)._

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Next pulls: job-payload contract suite (test-quality theme's founding motivation) · CPD campaign 1 (council-first) · legacy-column Phase A DROP (destructive; premigrate `--allow-destructive` at its release).

**🧹 `[CHORE]` knip audit: are the 141 barrel-revealed common-types exports actually needed? — BEFORE the release cut (user directive 2026-07-04)** — Gutting the root barrel (PR #1476) unmasked 141 intentionally-exported-but-unconsumed items — 129 `schemas/api` z.infer contract types + 11 generated command-option schemas + 1 interface — that the barrel's `export *` had hidden from knip. #1476 config-recognized them (added `src/schemas/api/**` + `src/generated/**` to common-types' `entry` in `knip.json`) to unblock the gut; **that config is the mask to re-examine.** The audit is the deferred call: per cluster, intended public API (keep) or dead (prune the export). Gate: do NOT cut the release with this open. Start: `git grep` each flagged symbol repo-wide (all currently have zero consumers — that's why they flagged); decide keep-vs-prune per group, then tighten the `knip.json` entry back down to only what's genuinely API.

**✨ `[FEAT]` Boulder design pass — BEFORE 2026-07-07 (Fable→Opus handoff)** — User directive 2026-07-03: spend remaining strong-model days on design work for the hardest architecture. **Sweep DONE 2026-07-03** (report archived in mined-corpus): shortlist confirmed + ONE timing-critical addition. **Final agenda, in session order** (each → written design artifact + council pass; ordering is load-bearing):

  1. **Design system / platform-portable UX layer** (independent of the others; evidence-ready via the 2026-06-28 UX audit). MUST absorb: in-character error delivery (`ideas.md` entry — theme claims it), error-wording standardization, UX-consistency audit commitments.
  2. **Prompt-assembly architecture** (NEW from sweep — the missed peer): stability-tier partitioning (stable identity/constraints ∣ frozen per-turn history ∣ volatile RAG/datetime), extracting `<chat_log>` from the system prompt into a real messages array, provider-aware cache_control, surviving the reasoning-model system→user rewrite. Anchor: `provider-prompt-caching` theme + layered-system-prompting follow-up + inline-reply_to idea. **Sequenced BEFORE memory + agentic because all three reshape the same message-assembly surface** — its output is a shared design artifact the next two sessions conform to.
  3. **Memory architecture adjudication** (OpenMemory vs evolved-pgvector vs other; fresh upstream research REQUIRED first). MUST absorb: lore books ✓, message-actions history/memory consistency invariant, db-sync seed/deletion-propagation strategy; check `docs/proposals/backlog/MEMORY_MANAGEMENT_COMMANDS.md` for prior design work before re-deriving.
  4. **Agentic scaffolding** (tool loop; unlocks media gen + web tools + deep research; job-payload contract suite is the de-facto prerequisite build). Sketch the provider seam IF tool-calling proves provider-divergent (else provider abstraction stays gated on the 3rd-provider trigger).

**Below the fold (next design window, not pre-handoff): config-cascade semantics** — resolver priority, off-vs-inherit sentinel semantics, profiles-vs-presets; 5+ parked items defer to it (preset-cascade theme is the anchor). Real boulder, no prod pressure.

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the Stryker pilot arc (config-resolver ratchet at 87.81 + CI `mutation-tests` job; suite-wide expansion still open), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty — the beta.146 warmup sweep cleared all of them 2026-07-02)_

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
