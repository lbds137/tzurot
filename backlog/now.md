## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

_(none active)_

_Recently resolved:_ **`finish_reason: "error"` processed as success** (surfaced + fixed 2026-07-02, #1462, **RELEASED in beta.146**): a provider failure inside an HTTP 200 delivered a 1-char reply and poisoned an LTM row; the invoker now throws retryable (stable message for classification safety; provider detail preserved via `response_metadata.openrouter.providerError`). Earlier: the **z.ai coding-plan "routing bug"** (surfaced 2026-06-28/29) was diagnosed 2026-07-02 as **not a routing defect** — auto-promotion fired correctly; z.ai-direct failed transiently (late-June z.ai instability, mechanism log-verified 2026-06-30 in the same window), the OpenRouter rescue succeeded, and the footer honestly reported the effective route (`via OpenRouter`), which read as "key not honored." Diagnostic probe cancelled; the remaining code defect (error-path footer mis-attribution, same seam) **shipped in #1456** — the error footer now renders the full route chain (`via Z.AI Coding Plan → OpenRouter (both routes failed)`). Earlier: the forwarded-message content-loss fix (#1391) and the TTS voice-output-dropped 300s stop-gap (#1389) shipped in **beta.142**; the DB connection-pool-starvation timeouts were fixed via #1250/#1251 and confirmed resolved 2026-06-25; the gateway persist-hang (soak-clean since beta.143; watch-items in `cold/follow-ups.md`) was a DIFFERENT failure mode (a single INSERT blocking with the pool healthy), not a pool-starvation regression.

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout + finishing-first — the release focus (no new epic)** — User decisions 2026-07-02/03: burn down the spinoff themes, and theme-CLOSERS outrank theme-starters. Roadmap + ordering in `active-epic.md`. Next pulls: job-payload contract suite (test-quality theme's founding motivation) · CPD campaign 1 (council-first) · legacy-column Phase A DROP (destructive; premigrate `--allow-destructive` at its release).

_beta.146 SHIPPED 2026-07-03 (11 PRs #1456–#1466): 2 prod provider-failure fixes, the complete Stryker arc (ratchet at 87.81 + CI `mutation-tests` job), **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit), weekly audit cron LIVE (maiden dispatch ✅ OK, Discord thread delivery proven end-to-end). Release review: "nothing survived verification as an actionable bug."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty — the beta.146 warmup sweep cleared all of them 2026-07-02)_

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
