### Theme: Tooling & Quality Ratchet

_Developer experience, schema-type discipline, CI strictness, and test infrastructure that keeps the codebase healthy as it grows._

#### 🏗️ Graduate Warnings to Errors (CI Strictness Ratchet)

Pre-push hook runs CPD and depcruise in warning-only mode (non-blocking). ESLint has warnings for complexity/statements that don't block CI. As we hit targets, tighten the ratchet:

- [x] **CPD**: ratchet shipped 2026-05-16 as `pnpm ops cpd:check` (CI lint job) + post-filter heuristic + boundary docs. See `docs/reference/CPD_CAMPAIGN_AUDIT.md` for the close-out audit and `02-code-standards.md` "Duplication, Helpers, and the CPD Ratchet" for the rules.
- [x] **Duplicate Exports**: `guard:duplicate-exports` already runs blocking in CI (no `continue-on-error`) and pre-push, with an `ALLOWLIST` mechanism in `packages/tooling/src/dev/check-duplicate-exports.ts` for intentional duplicates. Currently 0 violations across all packages. Ratchet effectively in place — the "baseline file" approach is unnecessary because the allowlist serves the same role and is more readable.
- [x] **ESLint warnings**: `eslint --max-warnings=0` is set on every package's lint script, so `complexity`, `max-statements`, `max-lines-per-function`, `max-depth`, `max-params`, `max-nested-callbacks`, and `sonarjs/cognitive-complexity` (all warn-level rules) effectively block CI. `pnpm lint` is currently clean (0 warnings of any kind). No baseline needed — the codebase is already at zero.
- [x] **Knip dead-files**: shipped 2026-05-17 — `pnpm knip:dead` now blocks in both the pre-push hook and the CI lint job. `pnpm knip` (unused exports/imports/deps) was already CI-blocking. Goal achieved: dead files surface immediately, not by audit cycle. The unused-exports half (`pnpm knip`) has been CI-blocking for a while; this closes the dead-files half.

**Theme status: CLOSED.** All four planned ratchets are in place. Future "block more warnings" work would go in a fresh theme; this one is complete.

#### 🏗️ Schema-Type Unification (Zod `z.infer`)

Adopt `z.infer<typeof schema>` across all job types to eliminate manual interface/schema sync. Each job type currently has both a Zod schema and a hand-written TypeScript interface kept in sync manually.

- [ ] Replace `ShapesImportJobData` / `ShapesImportJobResult` interfaces with `z.infer<>` derivations
- [ ] Same for `AudioTranscriptionJobData`, `ImageDescriptionJobData`, `LLMGenerationJobData`
- [ ] Consider discriminated unions for success/failure result types (compile-time enforcement that `personalityId` is required on success, `error` is required on failure)
- [ ] Audit all Zod schemas in common-types for interface/schema drift

**Context**: PR #651 added Zod schemas for shapes import jobs and an enforcement test that catches missing schemas. This follow-up eliminates the remaining duplication.

#### 🏗️ API Gateway Middleware Wiring Integration Tests

Add supertest-style integration tests that boot the actual Express app with real middleware. Verifies auth middleware is correctly applied (factory functions called, not just passed), routes respond properly, error middleware works. Audit `router.use(...)` calls for missing `()` on factory functions. Discovered during PR #691.

#### 🏗️ Investigate Safe Auto-Migration on Railway

Prisma migrations are currently manual post-deploy (`pnpm ops db:migrate --env dev/prod`). This caused a P2002 bug when a migration was deployed as code but never applied. Investigate: dev-only auto-migration in start command, pre-deploy hook with `prisma migrate deploy`, CI step that validates migration state matches schema.

#### 🏗️ Database-Configurable Model Capabilities

Move hardcoded model patterns (e.g., capability flags, context-window limits) to database for admin updates without deployment.

#### 🧹 Ops CLI Command Migration

Migrate remaining stub commands in `packages/tooling` to proper TypeScript implementations.
