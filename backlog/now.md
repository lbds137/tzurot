## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_None currently._ The DB connection-pool-starvation timeouts (surfaced 2026-06-11, root-caused + fixed 2026-06-18 via #1250/#1251 — explicit bounded `pg.Pool` `max=20` + finite 10s acquisition timeout + saturation gauge) were **confirmed resolved 2026-06-25**: prod logs show both pools correctly configured, zero saturation/errors/timeouts, and the user confirmed the preset-save/read timeout reports have stopped under load. Full root-cause writeup in git history.

---

### 🎯 Current Focus (max 3)

1. **Test-Pyramid Taxonomy + Coverage Audit — active epic** (see [`active-epic.md`](active-epic.md)). Shipped: Phase 1 (#1284), Phase 1.5 (#1285), **suffix rename (#1339)** (`.int`→`.component`, `.e2e`→`.integration`/`.contract`, `schema` kind dropped, pure-suffix classifier), **PR B — golden-fixture envelope contract + coverage-topology skeleton (#1340)**, and **Phase 2a — the code-derived topology generator (#1341)** (walks `ROUTE_MANIFEST` + payload `JobType`s + the envelope → 154 mechanism-tagged surfaces; `pnpm ops topology:generate`; report-only). **Next headline: Phase 2b** — mechanism-PRESENCE verification + `--write` the committed `coverage-topology.json` + the `topology:check` lockfile-diff CI gate, folding in the #1341 review items (see `active-epic.md` › Phase 2b). → then Phase 4 (`test:tier-audit` ratchet). **Deferred to one consolidated grab-bag cleanup PR after the headline work** (per user): the #1339/#1340 review nits — dead-guard sweep, `ci.yml` naming, `tests/e2e` dir rename, path-traversal guard, contract-fixture enrichment scenarios (see `active-epic.md` › Epic grab-bag).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
