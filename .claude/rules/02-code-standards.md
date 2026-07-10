# Code Standards

## ESLint Limits (CI Enforced)

| Rule                     | Limit | Level | Fix Strategy           |
| ------------------------ | ----- | ----- | ---------------------- |
| `max-lines`              | 400   | Error | Split + move tests     |
| `max-lines-per-function` | 100   | Warn  | Extract helpers        |
| `complexity`             | 20    | Warn  | Data-driven approach   |
| `max-depth`              | 4     | Warn  | Early returns, extract |
| `max-params`             | 5     | Warn  | Options object pattern |
| `max-nested-callbacks`   | 3     | Warn  | Extract/flatten        |
| `max-statements`         | 50    | Warn  | Extract helpers        |

**Note**: Test files (`*.test.ts`, `*.spec.ts`) are fully excluded from ESLint
via the `ignores` block in `eslint.config.js`. The limits above apply to
production code only. Do NOT split test files to satisfy max-lines — keep all
tests for a module in one colocated file for discoverability.

**To fix `max-lines`**: Extract code (functions, helpers, types) to a new module.
**NEVER** trim, compact, or shorten comments/JSDoc to fit the line limit.
Comments document intent — removing them to satisfy a linter is always wrong.

## Lint Suppression Standards

When adding `eslint-disable` or `ts-expect-error`, every suppression MUST have a meaningful justification via `--` comment.

| ❌ Banned justifications | ✅ Good justifications                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `-- pre-existing`        | `-- Multi-strategy lookup: UUID → name → slug → alias`                 |
| `-- legacy`              | `-- BFS traversal with inherent nested loops`                          |
| `-- tech debt`           | `-- Express router internals are untyped`                              |
| `-- TODO fix later`      | `-- Null guard before property access; collapsing reduces readability` |

Rules:

1. **Describe WHY the code needs the suppression**, not that it's old
2. **If the reason is "this code is messy"** — refactor it instead of suppressing
3. **"pre-existing" is not a justification** — it just means nobody bothered to explain
4. Run `pnpm ops xray --suppressions` to audit; target 0 unjustified items

## Temporal Markers in Code Comments

**Don't reference dates, PR numbers, or review-archaeology in code comments.** They rot meaninglessly the moment the surrounding context shifts — a `// Caught in PR #847 round 3` marker tells a future reader nothing useful once #847 is squashed into the history. Keep the _invariant explanation_ (why this constraint exists, what it protects against) and drop the _archaeology_ (when, who, which review).

| ❌ Don't write                                 | ✅ Instead                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `// Added 2026-05-06 to fix data loss`         | `// Required for parity with API schema cap; UI silently truncated otherwise`             |
| `// Caught in PR #985 final round review`      | `// Async work before showModal blows the 3-second budget; must wrap in timeout helper`   |
| `// Surfaced 2026-04-25 by claude-bot`         | `// guards against the empty-default leaking into ON CONFLICT path`                       |
| `* Background: PR #983 raised the cap to 4000` | `* Cap mirrors API schema's SHORT_PARAGRAPH_MAX_LENGTH; do not raise without bumping API` |

This applies to all comment shapes: full-line `//`, JSDoc `*` body, block `/* */`. Backlog markdown (`backlog/**/*.md`) is exempt — it intentionally tracks surfacing dates and PR origins.

**Where archaeology _does_ belong**: commit messages (preserved by git), PR descriptions, post-mortems (`docs/incidents/`), and backlog entries with explicit "Surfaced 20YY-MM-DD" prefixes. Code comments document the _invariant_, not the _journey_.

**Enforcement**: `.husky/pre-commit` scans newly-added comment lines in `*.ts`/`*.tsx`/`*.js`/`*.jsx` for date stamps, PR refs, and round/review markers. Override with `TZUROT_SKIP_TEMPORAL_CHECK=1` for the rare intentional case (post-mortem references where the date is the point).

## TypeScript Strict Rules

- TypeScript `strict: true`, no `any` types
- Use `unknown` + type guards instead of `any`
- Validate with Zod at service boundaries
- Be explicit: `!== null`, `!== undefined` (no implicit boolean coercion)
- **No unused parameters** — `noUnusedParameters: true` is enforced. If a function no longer uses a parameter, remove it from the signature and update callers. The `_` prefix escape hatch is for cases where you don't control the signature (callbacks, interface implementations, error params) — not for keeping dead parameters "for compatibility."

## Refactoring Patterns

### Options Object Pattern (max-params fix)

```typescript
// ❌ BAD - 6 parameters
function process(a, b, c, d, e, f) { ... }

// ✅ GOOD - Options object
interface ProcessOptions { a: A; b: B; c: C; d: D; e: E; f: F; }
function process(opts: ProcessOptions) { ... }
```

### Data-Driven Approach (complexity fix)

```typescript
// ❌ BAD - High complexity from repeated if/else
if (a) { ... } if (b) { ... } if (c) { ... }

// ✅ GOOD - Data-driven, complexity stays at 2
const FIELDS = [{ key: 'a' }, { key: 'b' }, { key: 'c' }] as const;
FIELDS.map(({ key }) => /* handle */);
```

### Early Return Pattern (max-depth fix)

```typescript
// ❌ BAD - Deep nesting
if (data) {
  if (data.isValid) {
    if (data.items.length > 0) {
      /* logic */
    }
  }
}

// ✅ GOOD - Early returns, flat
if (!data) return defaultResult;
if (!data.isValid) return invalidResult;
if (data.items.length === 0) return emptyResult;
// actual logic at depth 1
```

## Pino Logger Format

```typescript
// ✅ CORRECT - Error object in first argument
logger.error({ err: error }, 'Failed to process request');
logger.info({ requestId, duration }, 'Request completed');

// ❌ WRONG - Will fail lint
logger.error(error, 'Failed to process');
```

## Testing Standards

### Test Tiers (canonical: see TESTING.md)

Tzurot uses Toby Clemson's 5-tier model — **unit** (mocked logic) · **component**
(one whole service over PGLite; our `*.component.test.ts`) · **integration** (a module
against a real external dep; our `tests/e2e/*.integration.test.ts`) ·
**contract** (provider↔consumer agreement; `tests/e2e/contracts/*.contract.test.ts`) · **e2e**
(full system). The canonical definitions live in **one place** —
[Test Tier Taxonomy](../../docs/reference/guides/TESTING.md#test-tier-taxonomy).
Do not re-define the tiers here or in the skill; link there (the
`pnpm ops guard:test-taxonomy` CI gate enforces this single-sourcing).

**Suffixes match tiers**: `*.component.test.ts` (component), `*.integration.test.ts`
(integration), `*.contract.test.ts` (contract), plain `*.test.ts` (unit).

**Schema test ≠ contract test.** A Zod schema test (a plain `*.test.ts`) validates a
single _type's own rules_ (which inputs the schema accepts/rejects) — structurally
**unit**-tier. A **contract test** verifies _two services agree_ on an interface.
Don't file Zod schema tests under "contract."

### Core Principles

1. Test behavior, not implementation
2. Colocated tests - `MyService.test.ts` next to `MyService.ts`
3. **When extracting code to a new file, extract/create the `.test.ts` file too** - Do NOT add `structure.test.ts` exclusions for modules with logic
4. Mock all external dependencies - Discord, Redis, Prisma, AI
5. Use fake timers - No real delays in tests
6. **Tests must be self-contained** - Each `it()` block sets up its own data; never depend on side effects from prior tests. Use `beforeAll`/`beforeEach` in a sub-describe for shared fixtures.
7. **Assert what crosses a mocked seam** - When you `vi.mock` a downstream module/collaborator, at least one test MUST assert the arguments that cross that seam (`expect(mockX).toHaveBeenCalledWith(...)`), not only the orchestrator's return value. A test that mocks the seam it's meant to verify **cannot catch a wiring bug at that seam** — the mocked collaborator returns the same thing whether the caller forwarded the right data or silently dropped it. For a multi-module flow (A → B → C where each is unit-tested with the next mocked), also keep ONE **wiring/seam test** that runs the real chain end-to-end and mocks ONLY the external boundary (network/DB/Redis/model client). Reference: `services/ai-worker/src/services/multimodal/visionFallbackChain.test.ts`.

   **Why this rule exists**: a feature shipped with green coverage but two real bugs (a dropped forwarded field between two functions, and a wrong output for an untested failure _sequence_) that every unit test missed — because they each mocked the seam. Line coverage marks the buggy lines "covered" (they executed); it has no concept of "this covered line forwarded the wrong thing." The only gate that catches a seam bug is a test that _asserts across the seam_ or runs the seam for real. Established 2026-07-01 after PR #1429's review caught the seam bugs by hand.

8. **Interface changes must sweep UNTYPED fixtures — and new fixtures should be typed** - When a shared type's shape changes, grep by a distinctive FIELD name in addition to the type name: untyped mock payloads (`vi.fn().mockResolvedValue({...})`) never reference the type, so both a type-name grep AND the compiler miss them — and a fail-soft catch downstream can hide the breakage entirely (a PGLite suite's usage-log writes silently no-oped this way). Prevent the class at authoring time by typing fixture payloads: `mockResolvedValue({...} satisfies ExtractionModelResult)` makes the compiler break the test when the interface moves.

**All packages are enforced by `structure.test.ts`** — services, common-types, embeddings, AND tooling. Adding a new `.ts` file without a colocated `.test.ts` will fail the test suite unless the file matches an exclusion pattern (types, constants, thin CLI wrappers, etc.).

### Fake Timers (ALWAYS Use)

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Promise rejections with fake timers (CRITICAL)
const promise = asyncFunction();
const assertion = expect(promise).rejects.toThrow('Error'); // Attach handler FIRST
await vi.runAllTimersAsync(); // Then advance
await assertion;
```

### When to Add Tests

| Change             | Unit | Schema      | Component (`.int`)           |
| ------------------ | ---- | ----------- | ---------------------------- |
| New API endpoint   | ✅   | ✅ Required | ✅ If DB/multi-service       |
| New `*.service.ts` | ✅   | If shared   | ✅ For complex DB operations |
| Bug fix            | ✅   | If schema   | If multi-component           |

**Integration test procedures**: See `/tzurot-testing` skill. Always run `pnpm test:component` after command structure changes.

### Schema Test Colocation

Schema tests follow the same colocation rule as all other tests:

- `schemas/api/persona.ts` → `schemas/api/persona.test.ts`
- `types/jobs.ts` → `types/jobs.test.ts`

Do NOT place schema tests in a separate directory.

## Types & Constants

### When to Add to Common-Types

| Content                | Add to Common-Types? | Location                |
| ---------------------- | -------------------- | ----------------------- |
| Value used in 2+ files | ✅ Yes               | `constants/<domain>.ts` |
| BullMQ job payloads    | ✅ Yes               | `types/queue-types.ts`  |
| HTTP API contracts     | ✅ Yes               | `types/schemas.ts`      |
| Service-internal types | ❌ No                | Keep in service         |

### Constant Naming

```typescript
export const MY_CONFIG = {
  /** Description */
  VALUE: 123,
} as const; // Always use 'as const'
```

## Module Organization

**Import from source modules, not index files.** Re-exports create circular import issues.

```typescript
// ✅ GOOD - Import from source
import { formatDate } from './utils/dateUtils.js';

// ❌ BAD - Re-exporting for convenience
import { formatDate } from './utils/index.js';
```

**Exception**: Package entry points (e.g., `@tzurot/common-types`) are acceptable.

**No wrapper re-export files.** Never create a local file that just re-exports from
another package. Import directly from the source package instead.

```typescript
// ❌ BAD - Wrapper file that re-exports (slugUtils.ts just doing
//   export { normalizeSlugForUser } from '@tzurot/common-types')
import { normalizeSlugForUser } from '../../utils/slugUtils.js';

// ✅ GOOD - Import directly from the package
import { normalizeSlugForUser } from '@tzurot/common-types';
```

Re-export wrappers add indirection, break vitest mocking (the mock of the package
doesn't intercept internal imports), and make dependency tracing harder.

## Python Standards (voice-engine)

The `services/voice-engine/` service uses Python 3.11+ with FastAPI. These
patterns are enforced by `ruff`, `mypy --strict`, and `pytest`.

### Error Handling

```python
# ❌ WRONG — HTTPException gets caught by the generic handler
except Exception as e:
    raise HTTPException(...)

# ✅ CORRECT — re-raise HTTPException before the generic catch
except HTTPException:
    raise
except Exception:
    logger.error("Operation failed", exc_info=True)
    raise HTTPException(status_code=500, detail="Operation failed")
```

### Input Validation

| Check                     | Pattern                                                 |
| ------------------------- | ------------------------------------------------------- |
| File size                 | `len(await file.read()) > MAX_AUDIO_UPLOAD_BYTES` → 413 |
| Voice ID (path traversal) | `_VOICE_ID_RE.match(voice_id)` → 400                    |
| MIME type                 | `content_type not in _AUDIO_EXTENSIONS` → 400           |
| Text length               | `len(text) > MAX_TTS_TEXT_LENGTH` → 400                 |

### Temp File Cleanup

Always use `try/finally` for temp files — model errors must not leak files:

```python
ref_tmp_path = None
try:
    # ... write temp file, do inference ...
finally:
    if ref_tmp_path is not None and os.path.exists(ref_tmp_path):
        os.unlink(ref_tmp_path)
```

### Logging

Use stdlib `logging` with structured fields (not `print()`):

```python
logger.info("Transcribed audio", extra={"chars": len(text)})
logger.warning("Voice not found", extra={"voice_id": voice_id})
logger.error("Operation failed", exc_info=True)
```

### Type Hints

- All functions must have parameter and return type annotations
- Use `Any` for NeMo/PocketTTS objects (no type stubs) — justify with `# type: ignore[import-untyped]`
- Target: `mypy --strict` passes

## Duplication, Helpers, and the CPD Ratchet

The CRUD config routes (admin/{llm,tts}-config, user/{llm,tts}-config) share extracted helpers; the raw-jscpd metric is paired with a post-filter that excludes call-expression-dominant fragments (the "standardized helper call site" false-positive class). The full close-out audit lives in [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../../docs/reference/CPD_CAMPAIGN_AUDIT.md).

### Config-route helpers — scope and boundary

The helpers in `services/api-gateway/src/utils/configRouteHelpers.ts` and `normalizeConfigNameOnPromote.ts` standardize the CRUD config-route shape:

- `parseBodyOrSendError(res, schema, body)` — Zod parse + send error
- `findConfigOrSendNotFound(res, fetchRow, resourceName)` — fetch + 404
- `findGlobalConfigOrSendError(res, fetchRow, options)` — fetch + 404 + isGlobal guard (admin paths)
- `findAdminUserOrSendError(res, prisma, discordUserId, logger)` — admin discordId → UUID
- `ensureNoNameCollision<TScope>(res, service, options)` — generic name-collision check; supports `postIsGlobal` for cross-namespace promotion paths
- `shapeDeleteResponse(warning, baseLogFields)` — conditional warning omission for delete
- `applyOwnerNamePromotion<TBody>(body, config, user)` — generic promotion patch construction

**Apply these helpers when:** the route follows the fetch-validate-respond shape over a top-level config row (LlmConfig, TtsConfig, similar future resources).

**Do NOT apply these helpers when:** the route uses cascade-override semantics (`user/{tts,stt,model}-override.ts`). Cascade overrides set/clear values on a personality-scoped key — a fundamentally different domain shape than CRUD. Forcing CRUD helpers there is the Wrong Abstraction trap per Kimi K2.6 and GLM 5.1 council review during campaign close-out.

### The 2-callback ceiling rule (when considering new extractions)

Before extracting a new shared helper from a duplicated route pattern, prototype the kernel signature. If the proposed shared function requires **more than 2 callback/predicate parameters** to handle observed divergences across the call sites, **the divergence is structural and the helper should NOT be extracted**. Leave the code inline; duplication is cheaper than the wrong abstraction.

The rule's symmetry: when council reviewers (or your own instinct) warn "this looks like Wrong Abstraction," try the prototype. Don't pre-decide; let the signature size be the empirical answer.

**The adapter-interface exception (council-ruled)**: a cohesive INTERFACE whose methods are authored together per implementor is ONE parameter, not N callbacks — even with 3+ methods. The test is cohesion: if removing one method makes the others meaningless (they produce/consume each other's outputs), it's an adapter seam; if the functions are independent degrees of freedom a caller could mix-and-match, it's callbacks and the ceiling applies. Precedents: `TtsProvider`, `EntitySectionAdapter` (findSection's sync bundle is what loadSectionData warms and resolveSectionContext composes — cohesive), vs. the rejected cascade-route "preamble helper" (schema + verify-access + pre-hook = independent knobs — ceiling). Constraint that keeps this honest: adapter IMPLEMENTATIONS live next to their implementor's code, never in the shared module.

### CPD measurement: raw vs filtered

- **`pnpm cpd`** — runs jscpd. Output is informational. The raw clone count cannot reach zero in a well-abstracted TypeScript codebase because jscpd's token matcher treats standardized call sites of shared helpers as new clones across consumers.
- **`pnpm ops cpd:filtered`** — runs the post-filter against jscpd's JSON output. Excludes fragments where ≥80% of classifiable lines are call-expression shape. This is the metric that reflects real duplication debt.
- **`pnpm ops cpd:check`** — CI gate. Fails the build if filtered lines exceed the baseline ceiling (`baseline.filteredLines + baseline.graceMargin`) recorded in `.github/baselines/cpd-baseline.json`.
- **`pnpm ops cpd:update-baseline`** — sanctioned path for updating the baseline. Writes the current filtered count to `cpd-baseline.json`, preserving existing `graceMargin` / `threshold` / `notes` / `version` fields. Includes `--dry-run` to preview the delta first (recommended). Use after applying one of the three legitimate paths below — never to "make CI pass" without doing the underlying work.

**When a clone trips the ratchet, ask first**: is this a new call-site of a shared helper (likely OK, will be excluded by the filter — investigate why the filter missed it) or a new copy-paste of business logic (real debt, fix it)? `pnpm ops cpd:filtered --show-pairs 25` shows the top remaining pairs to help triage.

**Do NOT bypass the ratchet by editing the baseline upward** without first either (a) extracting the duplication into a shared helper, (b) confirming the new clones are legitimate skeleton-shape uniformity not worth abstracting (apply the 2-callback rule), or (c) raising the threshold on `pnpm ops cpd:filtered` if the heuristic is misclassifying. Once one of (a)/(b)/(c) is done, `pnpm ops cpd:update-baseline --dry-run` to preview, then run without `--dry-run` to commit the change.
