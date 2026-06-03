## 🏗 Active Epic: Slim `@tzurot/common-types` — extract non-type domains (PR-2n)

_Focus: common-types has drifted past "types" into a grab-bag. Post-clients-extraction it's still 137 files / 22.8k lines / 938 exports, including a `factories/` dir (test mock-builders) and a `services/` dir (stateful logic, e.g. `ConversationHistoryService` 588 lines). A types package shouldn't host either. Extract them so the shared surface is actually types/schemas/constants/utils._

**Appraisal (2026-06-03):** the 938-export barrel is *wide*, not *tangled* — 0 internal barrel cycles, modest cross-subdomain coupling (`services/→schemas/` 8 files). So the export count is breadth, not spaghetti. The real architectural drift is non-types (services, factories) living in a types package. Extracting them is higher-leverage than the barrel-kill (which is import hygiene — perf + boundaries — tracked separately in icebox).

### Phase 1 — `factories/ → @tzurot/test-factories` (✅ DONE — PR #1142, 2026-06-03)

The 8 factory files (validated mock-builders consumed only by tests) moved to a new dedicated `@tzurot/test-factories` package. Note: the original plan targeted `@tzurot/test-utils`, but that would have closed a `common-types ↔ test-utils` build cycle (common-types' integration tests already consume test-utils' pglite). A dedicated package whose only edge is `test-factories → common-types` is the cycle-free shape. All 29 factory symbols were bot-client-specific (21 consumer files repointed); ai-worker/api-gateway never imported any. Dropped the `export * from './factories'` barrel line from common-types.

### Phase 2 — extract `services/` (design SETTLED 2026-06-03 via council: GLM-5.1 + Kimi-K2.6 + Qwen-3.7-max, unanimous Hybrid) — NEXT

`services/` holds ~36 files / ~8,900 LOC of stateful logic (config resolvers, Redis caches, Prisma data-mappers, pub/sub cache-invalidation services, `PersonalityService`/`UserService`/`ConversationHistoryService`). Approach: **relocate single-consumer services into their owning service; keep the genuinely-shared (2+ consumer) core in a small new dedicated package** with a tight charter (Kimi: "if it exceeds ~15 files the boundary is wrong"). The line is consumption topology, not domain: 1 consumer → relocate, 2+ → shared.

Council-settled specifics:

- **Pub/sub invalidation pairs → split.** Shared package owns the contract (base class + payload types + topic-name constants); concrete publishers → api-gateway, subscribers → ai-worker.
- **Kill the `prisma.ts` singleton in the shared package.** Each app owns its own `PrismaClient`; shared services that need it take it via constructor injection (already the project DI principle). All three models independently flagged this singleton as the mechanism that enabled the bot-client Prisma drift.
- **bot-client/Prisma drift = separate fix (see Phase 2.5), design as if bot-client is Prisma-free.** Evicting the shared singleton turns the drift into a compile error that forces the fix.

**Sequencing — DECIDED 2026-06-03 (user: optimize for no stopgaps): `PR-2o → Phase 2.5 → PR-2p → PR-2q`.**

- **PR-2o** — relocate all single-consumer services (ai-worker resolver stack + `ConversationRetentionService` → api-gateway). No new package/Prisma surgery; relocated services keep importing the common-types `getPrismaClient` singleton until 2p (deferred, not a stopgap). Low-risk opener; shrinks common-types. **This is the next code PR.**
  - ⚠️ **Start by re-deriving the single-consumer set from VALUE imports — do NOT trust the prior consumption map.** The Phase-2 design used an Explore-agent consumption map that was noisy: it counted **type-only** imports as usage (e.g. bot-client's `import type { PersonaResolver }` in `composition.ts`), which inflated several buckets. Before moving any file, for each `packages/common-types/src/services/*.ts` grep its exported symbol's **value** usage (not `import type`) across `services/{ai-worker,api-gateway,bot-client}/src` including tests, and confirm it's genuinely consumed by exactly one service. High-confidence single-consumer (verify, but expected to hold): the config resolvers (`LlmConfigResolver`/`TtsConfigResolver`/`SttResolver`/`ConfigCascadeResolver`) + their cache-invalidation subscribers → ai-worker; `ConversationRetentionService` → api-gateway. Everything else (PersonalityService, PersonaResolver, UserService, the pub/sub pairs, base classes, mappers, prisma.ts) stays put for 2p/2q.
- **Phase 2.5** (see below) — bot-client → Prisma-free. **Must land before PR-2p** so the singleton eviction doesn't force a temporary local-Prisma stopgap in bot-client.
- **PR-2p** — create the shared package, move the 2+-consumer core + plumbing, evict the `prisma.ts` singleton, constructor-inject Prisma. Clean post-2.5: only ai-worker + api-gateway consume the Prisma-backed shared services, and both own a client.
- **PR-2q** — split the pub/sub publisher/subscriber pairs to their ends. Needs the shared package (2p) for the shared base + contracts; Redis-based, independent of the Prisma work. Last.

### Phase 2.5 — fix the bot-client→Prisma drift (proper, user-chosen 2026-06-03)

bot-client calls `getPrismaClient()` (re-exported from common-types) at `index.ts:188`/`:644` and injects Prisma into `ConversationPersistence`/`MentionResolver`/`MessageReferenceExtractor`/`PersonalityService` — contradicting the documented "bot-client NEVER uses Prisma" rule. The `bot-client-no-prisma` depcruise guard only blocks direct `@prisma/client` imports, not the common-types re-export, so it never caught this. **Fix**: route bot-client's DB reads (conversation-history reference resolution) through api-gateway HTTP instead of touching the DB directly; then tighten the depcruise guard to also block the `getPrismaClient`/generated-client re-export path so it can't recur. Likely its own mini-epic given the read paths involved — it'll need a scoping pass when we reach it (enumerate exactly what bot-client reads from the DB → which api-gateway endpoints to add for those reads). **Sequencing DECIDED (2026-06-03): runs after PR-2o and before PR-2p** — 2p's singleton eviction would otherwise force a temporary local-Prisma stopgap in bot-client, which the user explicitly wants to avoid.

### Phase 3 (optional) — barrel-kill / exports-map

See icebox; import hygiene, 1,021 sites, lowest urgency. Reassess after Phases 1–2 shrink the surface.

---

### Historical reference: Route Manifest Scaffold + Typed-Client Codegen — ✅ COMPLETE (closed by PR-2l #1115, 2026-05-29)

Type-safe bot-client → api-gateway boundary via a single source-of-truth `ROUTE_MANIFEST` + generated scoped clients (ServiceClient / OwnerClient / UserClient) with branded `ActorDiscordId` / `SubjectDiscordId` types. Closed the recurring "forgot `userId`" / "wrong fetcher" / "wrong URL prefix" footgun class at the type level. Shipped across PRs #1093–#1116 (manifest scaffold → handler refactor → manifest coverage → dual-mount route-prefix cutover → full bot-client migration → legacy teardown); **zero legacy `callGatewayApi`/`adminFetch` callsites remain**. PR-2m (#1115-era) then extracted the generated clients + transport into the `@tzurot/clients` package. Full phase-by-phase log is in git history (commits + PR descriptions). Both PR-2m and PR-2n Phase 1 ship to prod for the first time in **beta.127**.
