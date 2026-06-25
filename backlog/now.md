## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_None currently._ The DB connection-pool-starvation timeouts (surfaced 2026-06-11, root-caused + fixed 2026-06-18 via #1250/#1251 — explicit bounded `pg.Pool` `max=20` + finite 10s acquisition timeout + saturation gauge) were **confirmed resolved 2026-06-25**: prod logs show both pools correctly configured, zero saturation/errors/timeouts, and the user confirmed the preset-save/read timeout reports have stopped under load. Full root-cause writeup in git history.

---

### 🎯 Current Focus (max 3)

1. **Test-Pyramid Taxonomy + Coverage Audit — active epic** (see [`active-epic.md`](active-epic.md)). Phase 1 (#1284) + Phase 1.5 (#1285) shipped; **council pass done 2026-06-25** (GLM-5.2 / Kimi-K2.7-code / Qwen-3.7-max) → it reframed Phase 2 from a hand-authored matrix to a **code-derived coverage topology** (cross-service surfaces → required/actual tiers; lockfile-diff in CI). **Suffix rename shipped (#1339)**: `.int`→`.component`, `.e2e`→`.integration`/`.contract`, `schema` file-kind dropped, `classifyTestFile` now pure-suffix. **Next: PR B** — the flagship bot-client→worker envelope **contract test** + a minimal `coverage-topology` skeleton (plan approved, `/home/deck/.claude/plans/floofy-rolling-crane.md`). Then Phase 2 discovery (full topology generator) → Phase 4 enforcement (`test:tier-audit` ratchet).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
