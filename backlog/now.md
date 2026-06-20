## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

- 🐛 **[ROOT-CAUSED + FIXED — pending prod validation] Systemic load-correlated gateway timeouts (DB connection-pool starvation)** — Symptom: intermittent `"Request timeout (gateway slow or unavailable)"` across **various** endpoints (preset/llm-config PUTs were the loudest surface — section-modal edit, global-toggle, set-default — but reads timed out too); reads aborted at ~2.5s, writes at ~20s; the gateway **logged NOTHING** during the slow window, then the request **often eventually completed**. Load-correlated, **prod-only** (not dev-reproducible). **Root cause — council-confirmed unanimous (2026-06-18, GLM-5.2 + Kimi-K2.7-code + Qwen-3.7-max)**: the Prisma 7 driver adapter (`@prisma/adapter-pg`) was constructed with NO pool options, so node-postgres used its defaults — `max=10` + `connectionTimeoutMillis=0` (**wait FOREVER** for a connection). Under concurrent load all 10 connections check out and the next handler **blocks on connection acquisition before any query runs or any line is logged**; the client aborts (2.5s read / 20s write), a connection later frees, the write lands late. The adapter also **ignores `?connection_limit=`**, so the limit could only ever be set in code — and wasn't. The transport's 2.5s read default (typed-client epic) amplified it across reads. **FIXED**: #1250 (explicit pg.Pool `max=20` via `DATABASE_POOL_MAX` + finite 10s acquisition timeout so saturation fails loudly + a saturation gauge that WARNs on `waitingCount>0`, on by default at 30s) + #1251 (the stray `dbSync`/`prisma-env` pools). **Confirm in prod after the release** — watch api-gateway/ai-worker logs for the `pg.Pool saturated — requests waiting` WARN (that confirms the diagnosis was right) and verify the timeout reports stop; if saturation still shows at max=20, bump `DATABASE_POOL_MAX`. **Investigation findings (2026-06-18)**: the per-request auth lookup is ALREADY cached (`UserService` 5-min TTLCache, short-circuits on hit — NOT a new follow-up); the context dual-write adds write *volume* but holds no long-lived connection (zero `$transaction` in prod code) and is deleted by Phase 2.5d anyway — so the council's leak/lock hypotheses don't apply. **Client-side mitigations retained**: the 20s WRITE budget (#1228) and the preset-save honest "may still be applying" UX (#1249). Surfaced 2026-06-11; root-caused + fixed 2026-06-18. **Remove from Production Issues once prod-validated post-release.**

---

### 🎯 Current Focus (max 3)

1. **Confirm the DB-pool-starvation fix in prod (post-release)** — the root cause was found + fixed this session (#1250 explicit bounded pg.Pool + saturation gauge, #1251 stray pools); see the 🚨 Production Issue entry. After the next release deploys to prod: watch api-gateway/ai-worker logs for the `pg.Pool saturated — requests waiting` WARN (gauge on by default at 30s) and verify the timeout reports drop. If saturation still appears at `max=20`, bump `DATABASE_POOL_MAX`. Then remove the issue from 🚨 Production Issues.

2. **PR-2n epic — Phase 2.5d (bot-client Prisma eviction — the remaining half)** — see [`active-epic.md`](active-epic.md). **2.5d context-assembly cutover SHIPPED in beta.135** (#1267 shadow-instrumentation delete, #1268 `CONTEXT_MODE` delete, #1269 ai-worker fail-loud `kind:'envelope'`, #1270 thin-envelope unconditional + `RAW_ENVELOPE`/`THIN_PAYLOAD` delete). **STILL REMAINING (the PR-2p-unblocking half, NOT done)**: bot-client still calls `getPrismaClient()` (`index.ts:23/:188/:654`) and injects Prisma into 5 services (`PersonalityService`, `ConversationHistoryService`, `UserService`, `PersonaResolver`, `MessageContextBuilder`); `MessageContextBuilder.ts` is still alive + wired (`index.ts:242` → `PersonalityChatManager` + `chat.ts`). Remaining work: migrate the bot-client routing reads off direct Prisma (the planned cached internal `loadPersonality` route + any others), delete `MessageContextBuilder` once its consumers move, evict `getPrismaClient`, then tighten the `bot-client-no-prisma` depcruise guard to block the `getPrismaClient` re-export + resolved `services/prisma`/`generated/prisma` paths. **Substantial — needs plan-mode (+ likely a council pass on the routing-read cutover).** Unblocks PR-2p. Per-PR slice history + fold-forwards in [`cold/epic-log.md`](cold/epic-log.md).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
