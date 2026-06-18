## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

- 🐛 **[ROOT-CAUSED + FIXED — pending prod validation] Systemic load-correlated gateway timeouts (DB connection-pool starvation)** — Symptom: intermittent `"Request timeout (gateway slow or unavailable)"` across **various** endpoints (preset/llm-config PUTs were the loudest surface — section-modal edit, global-toggle, set-default — but reads timed out too); reads aborted at ~2.5s, writes at ~20s; the gateway **logged NOTHING** during the slow window, then the request **often eventually completed**. Load-correlated, **prod-only** (not dev-reproducible). **Root cause — council-confirmed unanimous (2026-06-18, GLM-5.2 + Kimi-K2.7-code + Qwen-3.7-max)**: the Prisma 7 driver adapter (`@prisma/adapter-pg`) was constructed with NO pool options, so node-postgres used its defaults — `max=10` + `connectionTimeoutMillis=0` (**wait FOREVER** for a connection). Under concurrent load all 10 connections check out and the next handler **blocks on connection acquisition before any query runs or any line is logged**; the client aborts (2.5s read / 20s write), a connection later frees, the write lands late. The adapter also **ignores `?connection_limit=`**, so the limit could only ever be set in code — and wasn't. The transport's 2.5s read default (typed-client epic) amplified it across reads. **FIXED**: #1250 (explicit pg.Pool `max=20` via `DATABASE_POOL_MAX` + finite 10s acquisition timeout so saturation fails loudly + a saturation gauge that WARNs on `waitingCount>0`, on by default at 30s) + #1251 (the stray `dbSync`/`prisma-env` pools). **Confirm in prod after the release** — watch api-gateway/ai-worker logs for the `pg.Pool saturated — requests waiting` WARN (that confirms the diagnosis was right) and verify the timeout reports stop; if saturation still shows at max=20, bump `DATABASE_POOL_MAX`. **Investigation findings (2026-06-18)**: the per-request auth lookup is ALREADY cached (`UserService` 5-min TTLCache, short-circuits on hit — NOT a new follow-up); the context dual-write adds write *volume* but holds no long-lived connection (zero `$transaction` in prod code) and is deleted by Phase 2.5d anyway — so the council's leak/lock hypotheses don't apply. **Client-side mitigations retained**: the 20s WRITE budget (#1228) and the preset-save honest "may still be applying" UX (#1249). Surfaced 2026-06-11; root-caused + fixed 2026-06-18. **Remove from Production Issues once prod-validated post-release.**

---

### 🎯 Current Focus (max 3)

1. **Confirm the DB-pool-starvation fix in prod (post-release)** — the root cause was found + fixed this session (#1250 explicit bounded pg.Pool + saturation gauge, #1251 stray pools); see the 🚨 Production Issue entry. After the next release deploys to prod: watch api-gateway/ai-worker logs for the `pg.Pool saturated — requests waiting` WARN (gauge on by default at 30s) and verify the timeout reports drop. If saturation still appears at `max=20`, bump `DATABASE_POOL_MAX`. Then remove the issue from 🚨 Production Issues.

2. **PR-2n epic — Phase 2.5d (delete legacy context paths)** — see [`active-epic.md`](active-epic.md). Phase 2.5 is prod-validated through beta.130 (2026-06-14); 2.5a–2.5c-iii + Fork C + voice-ground-truth + iii-b-1/2/3 + iii-cleanup all shipped. **NEXT is 2.5d**: delete the legacy paths + `MessageContextBuilder` + bot-client's Prisma injections + the `CONTEXT_*` flags; tighten the depcruise guard. Unblocks PR-2p. The full per-PR slice history + fold-forwards are in [`cold/epic-log.md`](cold/epic-log.md).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- `[LIFT]` **Converge the two gateway `LlmConfigResolver` instances (+ optional pub/sub)** — Surfaced by PR #1239 (Bug X) review. The gateway constructs **two** `LlmConfigResolver` instances: the process-lifetime one wired into `RouteDeps` for `/ai/generate` job-chain model stamping (`services/api-gateway/src/index.ts`, no pub/sub, 10s TTL), and the request-scoped one in `services/api-gateway/src/routes/user/llmConfigResolve.ts`. Same DB cascade; the only cost is a second non-shared cache. The job-chain instance has **no pub/sub invalidation**, so for up to 10s after a user changes their LLM config an image-description job could be stamped with the stale model. **Action**: refactor `createResolveHandler` to accept the injected `LlmConfigResolver` from `RouteDeps` (it already accepts an injected `ConfigCascadeResolver`), construct one shared instance in `index.ts`, optionally wire `LlmConfigCacheInvalidationService` pub/sub to it. Low risk; closes the staleness gap.

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
