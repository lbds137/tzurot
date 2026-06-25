## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_None currently._ The DB connection-pool-starvation timeouts (surfaced 2026-06-11, root-caused + fixed 2026-06-18 via #1250/#1251 — explicit bounded `pg.Pool` `max=20` + finite 10s acquisition timeout + saturation gauge) were **confirmed resolved 2026-06-25**: prod logs show both pools correctly configured, zero saturation/errors/timeouts, and the user confirmed the preset-save/read timeout reports have stopped under load. Full root-cause writeup in git history.

---

### 🎯 Current Focus (max 3)

1. **Test-Pyramid Taxonomy + Coverage Audit — active epic** (see [`active-epic.md`](active-epic.md)). Shipped: Phase 1 (#1284), Phase 1.5 (#1285), **suffix rename (#1339)** (`.int`→`.component`, `.e2e`→`.integration`/`.contract`, `schema` kind dropped, pure-suffix classifier), and **PR B — the golden-fixture envelope contract + coverage-topology skeleton (#1340)** (council-reshaped: shared fixture artifact, no cross-package import; `pnpm ops topology:generate`). **Next headline: Phase 2** — the full code-derived topology generator (walk `ROUTE_MANIFEST` + `JobType`, derive tiers from tests, lockfile-diff in CI; must recognize golden-fixture contracts per the #1340 reconciliation note) → then Phase 4 (`test:tier-audit` ratchet). **Deferred to one consolidated grab-bag cleanup PR after the headline work** (per user): the #1339/#1340 review nits — dead-guard sweep, `ci.yml` naming, `tests/e2e` dir rename, path-traversal guard, contract-fixture enrichment scenarios (see `active-epic.md` › Epic grab-bag).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
