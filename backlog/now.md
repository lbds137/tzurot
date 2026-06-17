## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

- 🐛 **[INVESTIGATE — symptom confirmed, mechanism unknown] Preset (llm-config) PUTs time out — gateway >10s on the update path** — Preset edit (section modal), global-toggle, and set-default commands fail with `"Request timeout (gateway slow or unavailable)"`; the user retries and it keeps failing. **Confirmed from prod logs (2026-06-12 ~01:36–01:54 UTC, admin + user paths)**: bot-client calls `PUT /api/admin/llm-config/{id}` and `PUT /api/user/llm-config/{id}` (+ `.../set-free-default`); the gateway takes **>10s** so bot-client aborts. Gateway logs the matching `request aborted … responseTime=10005/9999/9990… statusCode:null` — pinned at the abort, request never completed. So it's **genuine gateway slowness on the llm-config update path**, not merely a too-short timeout (a config write should be sub-second). **Mechanism NOT yet known**: during those seconds the gateway logged NOTHING — prod `prisma:query` logging is off, no processing/error lines, no pool/lock/deadlock signals. Intermittent (some config ops in the same window succeeded), which *suggests* resource contention (DB connection-pool wait / lock) rather than a constant slow query — **hypothesis, unconfirmed**. **NOTE: not dev-reproducible** — it's load-correlated (prod has concurrent users; dev is a single user with no load), so it must be observed in PROD. Path: ship **targeted timing instrumentation to the prod llm-config PUT** (breakdown log: validate / DB write / cache-invalidation / total), OR stand up real perf observability first (see the Production Observability theme in `cold/queue.md`). **Two tracks**: (a) root-cause + fix the gateway slowness (real fix, OPEN); (b) the bot-client timeout — **MITIGATED 2026-06-16 (#1228)**: llm-config CRUD writes now use a 20s `GATEWAY_TIMEOUTS.WRITE` budget (was 10s); the transport defaults all write methods to WRITE, so a PUT taking >10s-but-<20s no longer false-aborts client-side. **Root cause (why the gateway PUT exceeds 10s at all) is NOT fixed** — a sub-second config write shouldn't approach 20s either. Still needs the prod timing instrumentation. Surfaced 2026-06-11 (user prod session); track (a) stays open.

---

### 🎯 Current Focus (max 3)

1. **PR-2n epic — Phase 2.5d (delete legacy context paths)** — see [`active-epic.md`](active-epic.md). Phase 2.5 is prod-validated through beta.130 (2026-06-14); 2.5a–2.5c-iii + Fork C + voice-ground-truth + iii-b-1/2/3 + iii-cleanup all shipped. **NEXT is 2.5d**: delete the legacy paths + `MessageContextBuilder` + bot-client's Prisma injections + the `CONTEXT_*` flags; tighten the depcruise guard. Unblocks PR-2p. The full per-PR slice history + fold-forwards are in [`cold/epic-log.md`](cold/epic-log.md).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

- `[FIX]` **Embed-only blank history (non-forwarded link embeds)** — **diagnostic settled 2026-06-17.** `embedsXml` is persisted ONLY for _forwarded_ messages (`ConversationPersistence.saveUserMessage:193`), so a regular non-forwarded link-embed message never persists it and renders blank once it ages out of the live-fetch window. The `EMBED_PERSIST_PROBE` answered the design question (reply-case dev sample: `embedCountAtPersist=1, embedsXmlPersisted=false`) — the embed IS present at persist time, so the fix is the **simple variant**: build + persist `embedsXml` for ALL messages with `embeds.length > 0` (drop the `isForwarded &&` gate at `ConversationPersistence.ts:193`), **not** a `messageUpdate` re-capture. **Caveat**: some link types (e.g. Reddit `/s/` share links) carry a thin/placeholder embed that resolves async — those could still need a `messageUpdate` follow-up, but the simple fix covers rich embeds (the common case). The natural beta.133 follow-on — the deferred (embed) half of context-assembly Bug C; the image half shipped in beta.133.

- `[LIFT]` **Converge the two gateway `LlmConfigResolver` instances (+ optional pub/sub)** — Surfaced by PR #1239 (Bug X) review. The gateway constructs **two** `LlmConfigResolver` instances: the process-lifetime one wired into `RouteDeps` for `/ai/generate` job-chain model stamping (`services/api-gateway/src/index.ts`, no pub/sub, 10s TTL), and the request-scoped one in `services/api-gateway/src/routes/user/llmConfigResolve.ts`. Same DB cascade; the only cost is a second non-shared cache. The job-chain instance has **no pub/sub invalidation**, so for up to 10s after a user changes their LLM config an image-description job could be stamped with the stale model. **Action**: refactor `createResolveHandler` to accept the injected `LlmConfigResolver` from `RouteDeps` (it already accepts an injected `ConfigCascadeResolver`), construct one shared instance in `index.ts`, optionally wire `LlmConfigCacheInvalidationService` pub/sub to it. Low risk; closes the staleness gap.

- `[CHORE]` **Align write-side `findFirst`-by-recency queries with the `id` tiebreak** — Surfaced by the beta.133 release review. PR #e103f658e gave the conversation-history **read** path a deterministic `id` tiebreak (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`). The **write-back** path in `packages/common-types/src/services/referenceImageDescriptions.ts:86-89` (`writeReferenceImageDescriptions`) still does `findFirst({ orderBy: { createdAt: 'desc' } })` with no `id` tiebreak — if two user messages share a `createdAt` ms, it could persist reference-image descriptions onto the wrong row. **Action**: add `{ id: 'desc' }` as the secondary sort here, and grep for any other `findFirst`/`findMany` ordered solely by `createdAt`/`updatedAt` on a write path and align them. Non-blocking — ms collisions on a single user's messages are rare; this closes the determinism gap the read path already has.

- `[CHORE]` **Dedup-stub edge-case tests (PR #1242 follow-ups)** — Surfaced by PR #1242 (dedup-stub attachment markers) review — two optional coverage gaps: (1) a `buildDedupedReferenceStub` test asserting markers **survive when they alone fill the `DEDUP_STUB_CONTENT` budget** (several long-named attachments → exercises the markers-first guarantee against `formatDedupedQuote`'s end-truncation), and (2) a **bot-client `ReferenceFormatter`** test asserting the image-only deduped stub produces the right content shape before it ships to the worker. **Action**: add both. Non-blocking — current tests cover the practical cases.

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
