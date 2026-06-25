## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_None currently._ The DB connection-pool-starvation timeouts (surfaced 2026-06-11, root-caused + fixed 2026-06-18 via #1250/#1251 — explicit bounded `pg.Pool` `max=20` + finite 10s acquisition timeout + saturation gauge) were **confirmed resolved 2026-06-25**: prod logs show both pools correctly configured, zero saturation/errors/timeouts, and the user confirmed the preset-save/read timeout reports have stopped under load. Full root-cause writeup in git history.

---

### 🎯 Current Focus (max 3)

1. **Test-Pyramid Taxonomy + Coverage Audit — Phase 2 (tier-gap matrix)** — promoted to Active Epic 2026-06-25 (see [`active-epic.md`](active-epic.md)). Phase 1 (taxonomy docs, #1284) + Phase 1.5 (2.5d pilot audit, #1285) shipped. **Next:** a **council pass** to scope Phase 2/3 + the enforcement bulk (per the "substantial pick earns a council pass before plan-mode" rule), then plan-mode. Phase 2 = inventory every service/flow against the 5 tiers → per-area gap matrix; Phase 3 = gap-fill (flagship: a bot-client→worker envelope contract test); enforcement bulk = a `test:tier-audit` ratchet.

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
