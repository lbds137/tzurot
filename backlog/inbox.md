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
