## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### `[FIX]` Embed-only blank history (non-forwarded link embeds)

**Surfaced 2026-06-16; diagnostic settled 2026-06-17; triaged from inbox 2026-06-17.** `embedsXml` is persisted ONLY for _forwarded_ messages (`ConversationPersistence.saveUserMessage:193`), so a regular non-forwarded link-embed message never persists it and renders blank once it ages out of the live-fetch window. **The `EMBED_PERSIST_PROBE` answered the open design question** (reply-case dev sample, 2026-06-17: `embedCountAtPersist=1, embedsXmlPersisted=false`) — the embed IS present at persist time, so the fix is the **simple variant**: build + persist `embedsXml` for ALL messages with `embeds.length > 0` (drop the `isForwarded &&` gate at `ConversationPersistence.ts:193`), **not** a `messageUpdate` re-capture. **Caveat**: some link types (e.g. Reddit `/s/` share links) may carry a thin/placeholder embed whose content resolves async — those could still need a `messageUpdate` follow-up, but the simple fix covers rich embeds (the common case). **Action**: drop the `isForwarded &&` gate so `embedsXml` builds for any message with embeds; dev-verify. The natural beta.133 follow-on — this is the deferred (embed) half of the context-assembly Bug C; the image half shipped in beta.133.

### `[LIFT]` Converge the two gateway `LlmConfigResolver` instances (+ optional pub/sub)

**Surfaced 2026-06-17** by PR #1239 (Bug X) claude-review. The gateway now constructs **two** `LlmConfigResolver` instances: the process-lifetime one wired into `RouteDeps` for `/ai/generate` job-chain model stamping (`services/api-gateway/src/index.ts`, no pub/sub, 10s TTL), and the request-scoped one in `services/api-gateway/src/routes/user/llmConfigResolve.ts`. They hit the same DB cascade; the only cost is a second non-shared cache. The job-chain instance has **no pub/sub invalidation**, so for up to 10s after a user changes their LLM config an image-description job could be stamped with the stale model (the conversation path already had this 10s window). **Action**: refactor `createResolveHandler` to accept the injected `LlmConfigResolver` from `RouteDeps` (it already accepts an injected `ConfigCascadeResolver`), construct one shared instance in `index.ts`, and optionally wire `LlmConfigCacheInvalidationService` pub/sub to it like `ConfigCascadeResolver` has. Low risk; closes the staleness gap the reviewer flagged.

### `[CHORE]` Align write-side `findFirst`-by-recency queries with the `id` tiebreak

**Surfaced 2026-06-17** by the beta.133 release review. PR #e103f658e gave the conversation-history **read** path a deterministic `id` tiebreak (`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`) so millisecond-colliding rows order consistently. The **write-back** path in `packages/common-types/src/services/referenceImageDescriptions.ts:86-89` (`writeReferenceImageDescriptions`) still does `findFirst({ orderBy: { createdAt: 'desc' } })` with no `id` tiebreak — if two user messages share a `createdAt` ms, it could persist reference-image descriptions onto the wrong row. **Action**: add `{ id: 'desc' }` as the secondary sort here, and grep for any other `findFirst`/`findMany` ordered solely by `createdAt`/`updatedAt` on a write path and align them to the same tiebreak. Non-blocking — ms collisions on a single user's messages are rare in practice; this closes the determinism gap the read path already has.

### `[CHORE]` Dedup-stub edge-case tests (PR #1242 follow-ups)

**Surfaced 2026-06-17** by PR #1242 (dedup-stub attachment markers) claude-review — two optional coverage gaps: (1) a `buildDedupedReferenceStub` test asserting markers **survive when they alone fill the `DEDUP_STUB_CONTENT` budget** (several long-named attachments → exercises the markers-first guarantee against `formatDedupedQuote`'s end-truncation), and (2) a **bot-client `ReferenceFormatter`** test asserting the image-only deduped stub produces the right content shape before it ships to the worker (the existing 33 tests cover routing, not this content shape). **Action**: add both. Non-blocking — current tests cover the practical cases.

> Note: 7 items previously filed here all shipped in PR #1082-1084 (Layer 2 + Layer 3 of the periodic-audit-enforcement proposal). The remaining work tracked in [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md) is Layers 4-5 (markdown baselines + `ops:health` cron aggregator).

_Shipped 2026-06-12 (quick-wins sweep, PRs #1191/#1192/#1193): stacked-JSDoc merge in check-duplicate-exports, contentToText replacing the BaseMessage content-as-string casts, integration-coverage services/** glob._

_Shipped 2026-06-03 (quick-wins sweep, PRs #1147/#1148/#1149): redis removal + test-factories depcruise boundary, `guard:dockerfile-dist`, view.ts coverage + typed preset unflatten pipeline._

_Shipped 2026-06-14 (#1202): admin-route test asserting `hasZaiCodingKey:true` accepts z.ai-only models (`z-ai/glm-5.2`) on create + update._
