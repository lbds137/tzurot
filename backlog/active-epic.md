## 🏗 Active Epic: Route Manifest Scaffold + Typed-Client Codegen

_Focus: Type-safe bot-client → api-gateway boundary via a single source-of-truth route manifest + generated scoped clients (ServiceClient / OwnerClient / UserClient). Closes the recurring "forgot `userId`" / "wrong fetcher" footgun class at the type level._

### Background

Recurring production-bug class: bot-client → api-gateway calls would silently break when a contributor forgot to pass `userId` to `adminFetch(path, { userId? })`, picked the wrong fetch helper, or hit the wrong URL prefix. TypeScript couldn't catch any of it because the boundary was untyped. Six-vendor council battle-test (Gemini 3.1 Pro, Claude Opus 4.7, GPT-5.5 Pro, GLM 5.1, Kimi K2.6, DeepSeek v4 Pro) converged on: the right end-state is a typed route manifest + codegen → scoped typed clients, with `ActorDiscordId` / `SubjectDiscordId` branded types reflecting the Discord owner-inspects-subject domain model.

End-state: the only legal way to call the gateway is through generated, scoped, type-safe client methods. Three footguns close at the type level — missing userId, wrong userId, wrong fetch function.

### Phase 1: Manifest scaffold + codegen tool (shipped)

- ✅ **PR-1.0**: `RouteDef` type + `ROUTE_MANIFEST` registry + branded `ActorDiscordId` / `SubjectDiscordId` types + `pnpm ops codegen:routes` command + initial manifest covering ~80 routes
- ✅ **PR-1.5a**: Timeout escape hatch on the generated client transport (`timeoutMs` per route)

### Phase 2: Handler refactor + codegen wiring (shipped)

- ✅ **PR-1.5b.2a** (#1093): Handler-export refactor — `createXxxRoutes(deps)` factories restructured to `handleXxx(deps): RequestHandler` named exports so the generated `mounts.ts` can wire handlers directly
- ✅ **PR-1.5b.2b** (#1094): Codegen wiring for `mounts.ts` + handler-name reconciliation + integration smoke test

### Phase 3: Manifest coverage (in progress)

- ✅ **PR-1.5c** (#1097): 36 missing user-route manifest entries (manifest 92 → 128 routes); resources.ts split into 6 sub-files; codegen learns required-vs-optional query params
- ✅ **PR-1.5d** (#1098): PR-1.5c follow-ups (shapes Zod bypass, ResolveUserConfigDefaults strong-typing)
- ✅ **PR-1.5e** (#1099): `/user/memory` CRUD design corrections — preview-token handshake (filter drift fix), idempotent PUT lock route, peek-validate-consume (token-waste fix), RouteDef foundation extensions (query union form, pagination factory, branded token types)
- ✅ **PR-1.5f** (#1100): declare 13 memory routes in manifest — handler-export refactor + 12 response schemas + `MemoryActionTokenService.peek*` companions + `memoryBatchHelpers.ts` extraction + `asyncHandler` returns `Promise<void>`. Manifest 128 → 141 (104 user, +13).
- ✅ **PR-1.5g** (#1101): wire RouteDef.meta to codegen JSDoc emission + new `meta.atMostOnce` tag (single-use-token contract; round-2 finding reclassified batchDelete/purge from `idempotent` to `atMostOnce`); 5 mutual-exclusivity invariant tests; 69 routes tagged. Diagnostic-lift candidate was retired as phantom (PR-1.5c had already lifted them). 3 review-surfaced quick-wins absorbed.

### Phase 4: Route-prefix cutover + bot-client migration (in progress)

- ✅ **PR-2a** (#1102, merged 2026-05-27): dual-mount `/api/{internal,admin,user}/*` alongside legacy mounts; `clientsFor(interaction)` factory; `commands/inspect` migrated as PoC (4 callsites); `pnpm ops legacy:count` burn-down CI gate with baseline (adminFetch=32, callGatewayApi=207); URL-encoding sweep test across all generated path-param methods; structural turbo-cache fix for cross-package `structure.test` scan; wallet rate-limiter path-scoped to `/api/user/wallet/*`. Also absorbed: 3 new deferred-backlog entries (normalizeDateTime extraction, walkDirectory TOCTOU, shared stub-helper extraction).
- ⏳ **PR-2b…j**: per-area bot-client migrations sequenced by domain (memory / character / persona / admin / voice / wallet / etc.). Burn-down gate enforces strict-monotonic decrease per category. Three backlog items still tracked under this trigger:
  - Wallet rate-limiter middleware re-application (`quick-wins.md`) — partially addressed in PR-2a (path-scoped at gateway). Remaining: confirm coverage in PR-2 wallet slice.
  - Coordinated bot-client `/wallet/set` → `setWalletKey` typed-client migration (called out in PR #1097 round-8 review)
  - Re-check common-types export count post-PR-2 against the 50-export / 3000-line `xray` thresholds; propose `@tzurot/routes` or `@tzurot/clients` extraction if over (`deferred.md`)

### Phase 5: Cleanup (deferred, follows PR-2)

- ⏳ **PR-3+**: Delete superseded `GatewayClient.ts` methods that were stand-ins; consolidate `gatewayCaches.ts` (extracted from `GatewayClient`); remove the `routeDeps.ts` structure-test exclusion if RouteDeps ever grows logic

### Why this epic exists

The session log showed 6+ PRs already on this arc with no tracked epic — that was an oversight. Filed retroactively (2026-05-26) so the remaining PRs (1.5g, 2, 3+) ship under a named umbrella with visible phase tracking.

### PR-2 slice structure (decided 2026-05-27 in PR-2a council pass)

Council-vetted 9-PR sequence (GLM 5.1, Kimi K2.6, Qwen 3.7 Max all converged):

- ✅ **PR-2a**: dual-mount + factory + PoC + burn-down gate (shipped #1102)
- ⏳ **PR-2b…i** (~8 PRs): per-area bot-client migrations at 15–25 callsites each. Burn-down gate enforces monotonic decrease per category.
- ⏳ **PR-2j**: legacy deletion final pass. Delete `adminApiClient.ts`, `userGatewayClient.ts`, the legacy `/admin /user /internal` mounts in `index.ts`, the `legacy:count` gate, and the baseline file. Counts must be zero at this point.

The atomic-cutover option (single PR replaces mounts + all 243 callsites) was rejected because Railway deploys api-gateway and bot-client independently — there's no way to flip both prefixes simultaneously. Dual-mount avoids the race entirely.
