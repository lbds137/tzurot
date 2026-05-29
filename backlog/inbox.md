## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### `[LIFT]` PR-1.5b.2b: wire mounts.ts codegen after handler refactor

**Surfaced 2026-05-25** while shipping PR-1.5b.2a (PR #1093).

The handler-export refactor in PR-1.5b.2a (#1093) established `handle{Name}(deps): RequestHandler` factories across all admin + user + ai + internal routes. The follow-up wires the existing `mounts-builder.ts` into the codegen orchestrator so the generator can actually produce `services/api-gateway/src/routes/_generated/mounts.ts`.

**Work to do**:

1. **Reconcile handler names with manifest IDs** (~10 mismatches). The codegen's resolver is `handle${pascalCase(routeId)}`, so each manifest ID must have a handler export that exact name. Currently:
   - `model-override.ts`: rename `handleClearModelOverride` → `handleDeleteModelOverride`; `handleGetModelDefault` → `handleGetDefaultModelConfig`; `handleSetModelDefault` → `handleSetDefaultModelConfig`; `handleClearModelDefault` → `handleClearDefaultModelConfig`
   - `tts-override.ts`: rename `handleClearTtsOverride` → `handleDeleteTtsOverride`; `handleSetTtsDefault` → `handleSetTtsDefaultConfig`; `handleClearTtsDefault` → `handleClearTtsDefaultConfig`; `handleGetTtsDefault` → ? (no manifest entry; either add to manifest or omit from codegen)
   - `stt-override.ts`: rename `handleGetSttOverride` → `handleGetSttDefaultProvider`; `handleSetSttOverride` → `handleSetSttDefaultProvider`; `handleClearSttOverride` → `handleClearSttDefaultProvider`
2. **Build the `handlerPathFor` resolver** in `packages/tooling/src/codegen/routes.ts`. Map each route ID → relative import path from `services/api-gateway/src/routes/_generated/`. Easiest shape: a hardcoded `Record<string, string>` constant. Many handlers cross audience-folder boundaries (e.g., `aiGenerate` is `internal` audience but lives in `routes/ai/generate.ts`), so a simple `'../{audience}/{file}.js'` heuristic won't work — build the map explicitly.
3. **Wire `buildMountsFile` into `runCodegen`** alongside the existing client-class generation. Emit to `services/api-gateway/src/routes/_generated/mounts.ts`.
4. **Run `pnpm ops codegen:routes`** and commit the generated `mounts.ts`. NOT wired into `index.ts` yet — that's PR-2's atomic-cutover work.
5. **Integration test**: `services/api-gateway/src/routes/_generated/mounts.int.test.ts` builds the full Express app with `mountInternal/Admin/UserRoutes`, hits each prefix with various auth header combos, asserts 401/403/200 shapes. Replaces ad-hoc auth-shape testing scattered across individual route tests.
6. **Remove the temporary `knip.json` ignore** on `routeDeps.ts` and the `EXCLUDE_PATTERNS` entry in `structure.test.ts` once `mounts.ts` lands.
7. **Decide `RouteDeps.cascadeResolver` fate**: declared on the interface but currently unused — the one usage in `handleResolvePersonalityCascade` constructs its own `ConfigCascadeResolver` with `enableCleanup: false`. Either wire `deps.cascadeResolver` into a consumer or drop it from the interface to avoid the dead-field confusion.
8. **`requireProvisioned` hoist polish**: `createModelOverrideRoutes` hoists `const requireProvisioned = requireProvisionedUser(deps.prisma)`; other multi-endpoint factories (`createTtsOverrideRoutes`, `createConfigOverrideRoutes`, etc.) repeat `requireProvisionedUser(deps.prisma)` inline per route. Apply the hoist pattern uniformly while reworking these files for codegen.
9. **Optional: add direct unit tests for the new `handle*` exports** in `tts-config.ts` / `llm-config.ts` (currently covered transitively via the `createXxxRoutes` factory tests). Useful once codegen wires the handlers directly — failures should surface against the handler, not the factory.

**Why deferred from PR-1.5b.2**: the handler-export refactor was already large (92 files, ~3200 LOC). User chose to ship the refactor as PR-1.5b.2a so review can focus on the mechanical work; codegen wiring + handler renaming gets its own focused PR.

**How to apply**: pick up after #1093 merges. Work is mechanical; ~2-3 hours focused.

### `[FIX]` Convert persona-create unique-constraint collision to a 409

Both `handleCreatePersona` in `crud.ts` and `handleCreatePersonaOverride` in `override.ts` derive a deterministic UUID via `generatePersonaUuid(name, user.id)`. If a user already owns a persona with the same name, `persona.create` throws Prisma `P2002` which `asyncHandler` converts to a generic 500 — the bot-client surfaces "❌ Failed to create persona" with no indication that the actual cause is a name collision.

**Fix shape**: catch `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` in both handlers, map to a 409 conflict response. Bot-client side: update the create flow to surface the 409 with a helpful message ("Pick a different name or edit the existing one with /persona edit").

Surfaced 2026-05-28 by PR #1108 round-2 claude-bot review. Promoted from deferred 2026-05-29 (was parked behind "user complains" — but this is a clear, low-risk fix).

### `[FIX]` Scope-change in deny edit silently drops old entry on partial failure

`services/bot-client/src/commands/deny/detailEdit.ts` handles scope changes by upserting the new entry (line ~155) THEN removing the old one (line ~177). If the new-scope upsert succeeds but the old-scope `removeDenylistEntry` fails (transient gateway error, race, etc.), the user sees a success message but BOTH entries persist — duplicate denials for the same entity. Pre-existing behavior preserved through the PR-2f typed-client migration.

**Fix shape**: check `removeDenylistEntry` result; if `!ok`, either (a) surface a partial-success warning ("New entry created, but failed to remove old entry — use /deny browse to verify") or (b) attempt to roll back the new-scope upsert. Option (a) is honest and small; (b) introduces a third API call that itself can fail.

Surfaced 2026-05-28 by PR #1109 round-3 claude-bot review. Promoted from deferred 2026-05-29.

### `[FIX]` Distinguish "empty history" from "fetch failed" in `/shapes status`

`services/bot-client/src/commands/shapes/status.ts:50-79` displays "No imports yet" / "No exports yet" whenever the import/export job-history fetch returns falsy data — including when `result.ok` is `false` (gateway down, auth dropped, 5xx). A user with 10 past imports who hits a transient 503 sees "No imports yet" and might think their history vanished.

**Fix shape**: branch on `!result.ok` before the empty-list branch; emit `logger.warn({ status, error })` for observability and render "Could not load history (try again)" instead of "No imports yet." Mirror for `exportJobsResult`. ~10 LOC.

Surfaced 2026-05-27 by PR #1105 round-1 claude-bot review. Promoted from deferred 2026-05-29.

### `[LIFT]` Tighten `DbSyncResponseSchema` to drop `.passthrough()`

`packages/common-types/src/schemas/api/admin-operations.ts` declares `DbSyncResponseSchema` with `.passthrough()` because the api-gateway handler spreads an operation-result object with fields that vary per Prisma migration. The bot-client's `db-sync.ts` reads these via `as SyncResult` cast, bypassing compile-time checking.

**Fix shape**: declare the full response shape in the schema (mirror `AdminCleanupResponseSchema`'s tightening done in PR-2c) — `stats` becomes `z.record(z.string(), z.object({ devToProd: z.number().optional(), prodToDev: z.number().optional(), conflicts: z.number().optional() }))`, `warnings`/`info` become `z.array(z.string()).optional()`, etc. Drop `.passthrough()` and the `as SyncResult` cast in the bot-client. ~25 LOC schema + drop the cast + the local `SyncResult` interface.

Surfaced 2026-05-27 by PR #1104 round-3 claude-bot review. Promoted from deferred 2026-05-29.
