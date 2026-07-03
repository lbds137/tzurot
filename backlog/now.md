## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

**🐛 `[FIX]` `finish_reason: "error"` (provider failure inside a 200) is processed as a SUCCESS** — Surfaced 2026-07-02 ~03:00Z (user /inspect + full ai-worker log trace, request `f333a5db`, runtime-confirmed). A promoted z.ai request short-circuited on a cached 429 → OpenRouter fallback → the upstream provider (Decart serving `z-ai/glm-5.2`) ground 123s and returned **HTTP 200 with `finish_reason: "error"` and 1 char of content** (OpenRouter's provider-died-mid-generation shape). The invoker logged `Model completion with non-standard finish_reason` and then treated it as a normal completion: `LLM invocation succeeded on attempt 1`, job `success=true`. Consequences: (a) the user got a 1-character persona reply after a 2-minute wait, (b) **the 1-char interaction was stored to LTM** (memory poisoning — single row, no backfill per the ephemeral-history/heal-on-read standing rule), (c) no retry fired — the empty-response retry keys on `content.length === 0` and 1 char sneaks past, (d) the /inspect reasoning-LEAK flag false-positived on the degenerate 1-char reasoning detail. **Fix shape**: in `LLMInvoker` (the `non-standard finish_reason` log site), treat `finish_reason === 'error'` as a THROWN retryable failure so the existing retry ladder + auto-promotion fallback machinery handle it — never a deliverable completion. Scope the throw to `'error'` specifically (don't blanket all non-standard values — e.g. length/content-filter have different semantics). Consider whether the 1-char-content + error-finish combination should also harden the empty-response guard (`length === 0` → a degenerate-response predicate). **Start**: `services/ai-worker/src/services/LLMInvoker.ts` ("Model completion with non-standard finish_reason" log), `ResponsePostProcessor`, the empty-retry loop in `GenerationStep.generateWithDuplicateRetry`.

_Recently resolved:_ the **z.ai coding-plan "routing bug"** (surfaced 2026-06-28/29) was diagnosed 2026-07-02 as **not a routing defect** — auto-promotion fired correctly; z.ai-direct failed transiently (late-June z.ai instability, mechanism log-verified 2026-06-30 in the same window), the OpenRouter rescue succeeded, and the footer honestly reported the effective route (`via OpenRouter`), which read as "key not honored." Diagnostic probe cancelled; the remaining code defect (error-path footer mis-attribution, same seam) **shipped in #1456** — the error footer now renders the full route chain (`via Z.AI Coding Plan → OpenRouter (both routes failed)`). Earlier: the forwarded-message content-loss fix (#1391) and the TTS voice-output-dropped 300s stop-gap (#1389) shipped in **beta.142**; the DB connection-pool-starvation timeouts were fixed via #1250/#1251 and confirmed resolved 2026-06-25; the gateway persist-hang (soak-clean since beta.143; watch-items in `cold/follow-ups.md`) was a DIFFERENT failure mode (a single INSERT blocking with the pool healthy), not a pool-starvation regression.

---

### 🎯 Current Focus (max 3)

**🏗️ `[LIFT]` Spinoff-theme knockout — the beta.146+ release focus (no new epic)** — User decision 2026-07-02: burn down the themes spun off from completed epics instead of picking a new epic from the queue. Roadmap + ordering in `active-epic.md`. Remaining warmup first: the Quick Wins below (the footer-chain fix already shipped as #1456).

_beta.145 SHIPPED 2026-07-02 (14 PRs): all five openers + the backlog-shrink pass (#1447–#1450) + clean-first builds (#1451) + guard:workflow-sync (#1452 + main-cut #1454) + the TTS backfill test (#1453). Release review: "no changes requested."_

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty — the beta.146 warmup sweep cleared all of them 2026-07-02)_

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
