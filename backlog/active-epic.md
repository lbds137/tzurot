## 🏗 Active Epic: Slim `@tzurot/common-types` — extract non-type domains (PR-2n)

_Focus: common-types has drifted past "types" into a grab-bag. Post-clients-extraction it's still 137 files / 22.8k lines / 938 exports, including a `factories/` dir (test mock-builders) and a `services/` dir (stateful logic). A types package shouldn't host either. Extract them so the shared surface is actually types/schemas/constants/utils._

> **Detailed history** — the full per-PR slice log (2.5a → iii-cleanup), the Phase-2.5 cluster scoping tables, the council verdicts, and the 2026-06-08 burn-in results live in [`cold/epic-log.md`](cold/epic-log.md). This file is the roadmap + the current/next phase only.

**Appraisal (2026-06-03):** the 938-export barrel is *wide*, not *tangled* — 0 internal barrel cycles, modest cross-subdomain coupling. The export count is breadth, not spaghetti. The real architectural drift is non-types (services, factories) living in a types package; extracting them is higher-leverage than the barrel-kill (import hygiene — tracked in [`cold/ideas.md`](cold/ideas.md)).

### Phase 1 — `factories/ → @tzurot/test-factories` (✅ DONE — PR #1142)

8 factory files (validated mock-builders consumed only by tests) moved to a dedicated `@tzurot/test-factories` package — cycle-free (its only edge is `test-factories → common-types`). 21 bot-client consumer files repointed; the `export * from './factories'` barrel line dropped.

### Phase 2 — extract `services/` (design SETTLED 2026-06-03 via council, unanimous Hybrid)

`services/` holds ~36 files / ~8,900 LOC of stateful logic. Approach: **relocate single-consumer services into their owning service; keep the genuinely-shared (2+ consumer) core in a small new dedicated package** (Kimi's charter: "if it exceeds ~15 files the boundary is wrong"). The line is consumption topology — 1 consumer → relocate, 2+ → shared. Pub/sub invalidation pairs split (shared contract; publishers → api-gateway, subscribers → ai-worker); the `prisma.ts` singleton dies (each app owns its `PrismaClient`, constructor-injected — this also turns the bot-client Prisma drift into a compile error).

**Sequencing — DECIDED 2026-06-03 (optimize for no stopgaps): `PR-2o ✅ → Phase 2.5 → PR-2p → PR-2q`.**

- **PR-2o ✅** — single-consumer relocation done 2026-06-04 (`ConversationRetentionService` → api-gateway, `VisionDescriptionCache` → ai-worker). Verification falsified the expected move set: the resolver stack (`LlmConfigResolver`/`TtsConfigResolver`/`SttResolver`/`ConfigCascadeResolver`) is 2-consumer (ai-worker jobs + api-gateway resolve routes), so it moves to PR-2p's shared package instead. Detail in epic-log.
- **Phase 2.5** — bot-client → Prisma-free. **Must land before PR-2p** (so the singleton eviction doesn't force a temporary local-Prisma stopgap). **Status below.**
- **PR-2p** — create the shared package, move the 2+-consumer core (incl. the full config-resolver stack + cache-invalidation services), evict the `prisma.ts` singleton, constructor-inject Prisma.
- **PR-2q** — split the pub/sub publisher/subscriber pairs to their ends. Redis-based, independent of the Prisma work. Last.

### Phase 2.5 — fix the bot-client→Prisma drift (CURRENT PHASE)

bot-client calls `getPrismaClient()` (re-exported from common-types) throughout its message pipeline, contradicting the "bot-client NEVER uses Prisma" rule (the `bot-client-no-prisma` depcruise guard only blocks direct `@prisma/client` imports, not the re-export). **Council verdict 2026-06-04 (GLM-5.1 + Kimi-K2.6 + Qwen-3.7-max, unanimous): Fork 2 — context-assembly relocation.** bot-client submits a thin `RawDiscordEnvelope`; ai-worker's `ContextStep` re-derives context via a `ContextDataSource` (collapsing the MessageContextBuilder/ContextStep duplication — subtractive refactor). Generation persistence → ai-worker; Discord-event writes (edit/delete sync, delivery confirmation) → bot-client POSTs to api-gateway (~3 narrow internal endpoints). **Routing reads** (mention parsing, pre-job) can't relocate → cached internal `loadPersonality` route. Full fork analysis + verdict + the routing caveat are in [`cold/epic-log.md`](cold/epic-log.md).

**Shipped (prod-validated through beta.130, 2026-06-14):** 2.5a (#1153 shadow hydration) → 2.5b (#1154 internal endpoints + dual-write) → 2.5c-i (#1155 write cutover) → 2.5c-ii (#1156 routing-read cutover) → 2.5c-iii: iii-0 (#1157) → iii-a (#1159/#1160) → a3 (#1161/#1162/#1163/#1165) → Fork C (#1166) → voice ground truth (#1169) → iii-b-1 (#1182) → iii-b-2 (#1183, thin payload) → iii-b-3 (#1194/#1195, last holdouts dropped) → iii-cleanup (#1196). The shadow diffs all 12 payload surfaces the envelope replaces; 2026-06-08 burn-in was GREEN (one weigh-in finding, resolved-by-design — see epic-log).

**NEXT — 2.5d (delete legacy):** delete the legacy paths, `MessageContextBuilder`, bot-client's Prisma injections, and the flags (`CONTEXT_MODE` collapses to service-only; `CONTEXT_DUAL_WRITE` + `CONTEXT_SHADOW_HYDRATION` die; `contextWritePath.ts` mirrors die). Then **tighten the depcruise guard**: extend `bot-client-no-prisma` (or add a sibling) to block `services/bot-client → packages/common-types/src/services/prisma` and `src/generated/prisma` resolved paths, plus a grep-style guard for `getPrismaClient` imports in bot-client — so `index.ts:188/:644` constructions die and the violation class can't silently return. Unblocks PR-2p.

**Fold-forwards to apply during 2.5d** (carried from #1154/#1155/#1182 reviews): consolidate the structurally-identical `SyncResult`/`ConversationSyncResult` and `ObservedSyncSnapshotMessage`/`ObservedSyncMessage` aliases when the bot-client types die; upgrade the snapshot-truncation warn to `error` (service-mode truncation = real data-loss risk); move `isAssemblyPromoteEnabled` out of `shadowHydration.ts` (it deletes anyway); the `ContextStep.sourceHistory` → `applyAssembledContext()` full return-value/dataflow restructure (the in-place mutation is load-bearing for cross-step propagation; idempotent by construction — a guard test pins it). Full fold-forward list in epic-log.

### Phase 3 (optional) — barrel-kill / exports-map

Import hygiene, 1,021 sites, lowest urgency — see [`cold/ideas.md`](cold/ideas.md). Reassess after Phases 1–2 shrink the surface.
