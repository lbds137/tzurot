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
- ✅ **PR-2b** (merged 2026-05-27): `commands/channel/{activate,deactivate,browse}` migrated to userClient. `settings.ts` deferred (4 manifest gaps).
- ✅ **PR-2c** (#1104, merged 2026-05-27): `commands/admin/*` migrated to ownerClient. Surfaced manifest correctness fixes (AdminUsageStatsSchema `period` field reclassification). Burn-down: adminFetch 32 → 26 (-6).
- ✅ **PR-2d** (#1105, merged 2026-05-28): `commands/shapes/*` migrated to userClient (-27 callGatewayApi callsites). Two backlog-deferred items absorbed inline: shared `gatewayClientStubs.ts` test helpers + `normalizeDateTime`/`normalizeDateTimeNullable` promotion to common-types. Manifest fixes: `query.slug?` declared on `listShapes(Import|Export)Jobs`; `ShapesExportJobSummarySchema.expiresAt` tightened to non-nullable. **Pre-existing fixes**: 3-second-ack-rule violation in `showDetailView` AND sibling `handleBrowsePage` both fixed inline (defer-first + editReply + nested-router guard); shared `safelyReportUnexpectedError` helper extracted to handle deferred-or-not error paths. Burn-down: callGatewayApi 207 → 180 (-27).
- ✅ **PR-2e** (#1106, merged 2026-05-28): `commands/persona/*` migrated to userClient (-21 callGatewayApi callsites). `createRefreshHandler` shared-infra signature cleaned up to remove `userGatewayClient` coupling. Burn-down: callGatewayApi 180 → 159 (-21).
- ✅ **PR-2e-followup** (#1108, merged 2026-05-28): implemented the missing `POST /user/persona/override/by-id/:personalityId` endpoint that was 404-ing silently in production. Atomicity via `prisma.$transaction` (no orphaned persona on upsert failure). Eliminates the last `callGatewayApi` callsite in `commands/persona/`. Persona-create modal `content` field tightened to `setRequired(true)` so Discord catches empty submissions client-side. 5 new gateway tests + bot-client tests fully migrated. Burn-down: callGatewayApi 159 → 156 (-3).
- ✅ **PR-2f** (#1109, merged 2026-05-28): admin/deny/history misc-leftovers bundle (-11 adminFetch, -10 callGatewayApi). New `serviceFetch` allow-list helper for the `/health` + `/metrics` infrastructure paths that intentionally live outside the manifest (Railway liveness + monitoring). `DenylistEntryResponse` tightened from loose interface to schema-derived `DenylistEntry` (literal unions for type/scope/mode, addedAt: Date). Manifest correctness fix: `canEdit` added to `GetPersonalityResponseSchema` (handler always returned it; bot-client was casting via untyped `as`). Burn-down: adminFetch 26 → 15, callGatewayApi 156 → 146.
- ✅ **PR-2g** (#1110, merged 2026-05-28): `commands/channel/settings.ts` migrated to userClient — the PR-2b deferral resolved. Added 4 new channel-config-override schemas (Get/Update/Clear/UpdateRequest); registered `updateChannelConfigOverrides` (PATCH) and `clearChannelConfigOverrides` (DELETE); fixed the manifest's `getChannelConfigOverrides` output schema (was wrongly declared `ChannelSettingsSchema`; handler returned `{ configOverrides }`). Compile-time `_ReservedKeysDoNotCollide` guard on `sources`/`userOverrides` reserved meta-keys. Three backlog items filed: codegen mounts.ts same-module-import merging, prettier-on-backlog exemption, deferred `clearChannelConfigOverrides` wiring + happy-path test (with the additional `updateChannelConfigOverrides` failure-path + `resolveCascade` arg-assertion gaps surfaced in final review). Burn-down: callGatewayApi 146 → 141 (-5).
- ✅ **PR-2h** (#1111, merged 2026-05-28): all 8 memory command files migrated to userClient (`stats`, `focus`, `search`, `browse`, `batchDelete`, `purge`, `incognito`, `detailApi`/`detail`/`detailModals`). 9 test files rewritten to `gatewayClientStubs` pattern. Two schema correctness fixes: (1) `previewToken`/`purgeToken` brand types now flow through the response→input handshake (caller can't mix tokens); (2) `IncognitoSession.timeRemaining` corrected from `z.number().nullable()` to `z.string().min(1)` — handler always emits human-formatted strings ("1 hour", "Until manually disabled", "Expired"). Local `MemoryItem` re-export chain eliminated; all consumers now import directly from common-types. Two backlog items filed: `incognito.ts` timeframe cast → `satisfies` pattern, and pre-existing 3-second-rule violation in `handleEditButton`/`handleEditTruncatedButton` (`fetchMemory` precedes ack). Burn-down: callGatewayApi 141 → 115 (-26).
- ✅ **PR-2i** (#1112, merged 2026-05-29): all 7 character command files + 9 consumers migrated to userClient (`api`, `import`, `export`, `view`, `browse`, `avatar`, `voice`, `create`, `dashboardDeleteHandlers`). 16 test files rewritten to `gatewayClientStubs` pattern. Exported `toCharacterData<T>(p): Omit<T, 'characterInfo' | 'personalityTraits'> & {...}` helper centralizes the `CharacterData`/`PersonalityFull` schema-drift bridge (nullable→empty-string coercion + `avatarData: null` default). **Real bug fix**: `checkExistingCharacter` previously returned `{ exists: false }` on any non-OK response — silently masking transient 500s as 404s and triggering create attempts that surfaced as confusing 409 unique-constraint errors. New code throws on non-404 status, regression-guarded by `should not silently treat a 500 on the existence-check GET as "does not exist"`. **Timeout correctness fixes**: per-route `timeoutMs: GATEWAY_TIMEOUTS.DEFERRED` (10s) added to `getPersonality`, `resolveCascade`, and `resolvePersonalityCascade` — the post-defer dashboard chain was silently dropping to the 2.5s autocomplete-budget default after migration. Module-local `fetchCharacter` in `view.ts` renamed to `fetchCharacterForView` to disambiguate from the exported one in `api.ts`. Five backlog items filed: `incognito.ts` timeframe cast carryover, `handleEditButton`/`handleEditTruncatedButton` 3s-rule (carryover), `settingsUpdateFactory.ts` migration (PR-2g/2i bridge — overrides/settings tests still mock both transports), `autocompleteCache.ts` migration (gates 6 consumer files), `view.ts:handleView`/`handleViewPagination` test coverage gap, `browseResponse` userId-threading verification. Burn-down: callGatewayApi 115 → 93 (-22), adminFetch unchanged at 15.
- ✅ **PR-2j** (#1113, merged 2026-05-29): bundled shared-infra migrations + voice domain (`autocompleteCache.ts` + 6 consumers, `settingsUpdateFactory.ts` + 2 consumers, all 13 voice command files + `guestModeValidation` helper). 67 files net. Generated client classes expose `readonly actor`/`user` (was `private readonly`) so `userClient.actor` can serve as cache key. `AutocompleteInteraction` added to `ClientCarryingInteraction` union — autocomplete handlers now use `clientsFor(interaction)` at the boundary. **Manifest timeout sweep** (34 additions): every deferred-context route pinned at `GATEWAY_TIMEOUTS.DEFERRED`; autocomplete-only routes (`listPersonalities`/`Personas`/`Shapes`) pinned at `AUTOCOMPLETE`; `clearVoices` uses `BULK_OPERATION` (30s) for per-voice DELETE iteration; fixed silent timeout regression on `updatePersonalityOverrides`/`updatePersonalityConfigDefaults` caught by reviewer. `settingsUpdateFactory` config restructured from URL-builder callbacks to typed-client method callbacks (`patchFn`/`resolveFn`); dual-transport mock pattern eliminated across overrides/settings tests. Burn-down: callGatewayApi 93 → 55 (-38), adminFetch unchanged at 15.
- ⏳ **PR-2k**: wallet/preset + remaining 15-25 callsite domains, plus deferred items still tracked under PR-2 umbrella:
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
- ✅ **PR-2b**: channel commands activate/deactivate/browse → userClient (shipped 2026-05-27)
- ✅ **PR-2c**: admin commands → ownerClient (shipped #1104)
- ✅ **PR-2d**: shapes commands → userClient (shipped #1105)
- ✅ **PR-2e**: persona commands → userClient (shipped #1106)
- ✅ **PR-2e-followup**: implemented missing `createPersonaOverride` atomic endpoint (shipped #1108)
- ✅ **PR-2f**: admin/deny/history misc-leftovers bundle (shipped #1109)
- ✅ **PR-2g**: channel/settings → userClient (shipped #1110)
- ✅ **PR-2h**: memory commands → userClient (shipped #1111)
- ✅ **PR-2i**: character commands → userClient (shipped #1112)
- ✅ **PR-2j**: autocompleteCache + settingsUpdateFactory + voice domain (shipped #1113)
- ⏳ **PR-2k** (~1 PR): wallet/preset + remaining misc bot-client migrations at ~15-25 callsites each.
- ⏳ **PR-2l**: legacy deletion final pass. Delete `adminApiClient.ts`, `userGatewayClient.ts`, the legacy `/admin /user /internal` mounts in `index.ts`, the `legacy:count` gate, and the baseline file. Counts must be zero at this point.

The atomic-cutover option (single PR replaces mounts + all 243 callsites) was rejected because Railway deploys api-gateway and bot-client independently — there's no way to flip both prefixes simultaneously. Dual-mount avoids the race entirely.
