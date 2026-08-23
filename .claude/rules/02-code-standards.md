# Code Standards

## ESLint Limits (CI Enforced)

| Rule                     | Limit | Level | Fix Strategy           |
| ------------------------ | ----- | ----- | ---------------------- |
| `max-lines`              | 400\* | Error | Split + move tests     |
| `max-lines-per-function` | 100\* | Warn  | Extract helpers        |
| `complexity`             | 20    | Warn  | Data-driven approach   |
| `max-depth`              | 4     | Warn  | Early returns, extract |
| `max-params`             | 5     | Warn  | Options object pattern |
| `max-nested-callbacks`   | 3     | Warn  | Extract/flatten        |
| `max-statements`         | 50    | Warn  | Extract helpers        |

**\* Both line rules run with `skipBlankLines` + `skipComments`**
(separate `max-lines` and `max-lines-per-function` blocks in `eslint.config.js`,
carrying the same options), so `wc -l` is NOT the metric — a comment-heavy
395-raw-line file counted 196, and an unnecessary extraction was justified on
that false premise. `pnpm lint` is the only arbiter; to see the counted size,
force it out with
`npx eslint <file> --rule '{"max-lines":["error",{"max":1,"skipBlankLines":true,"skipComments":true}]}'`.

**Note**: Test files (`*.test.ts`, `*.spec.ts`) are excluded from the
size/complexity limits above but are still linted (vitest correctness + style
rules, no type-checking). Do NOT split test files to satisfy max-lines — keep
all tests for a module in one colocated file.

**To fix `max-lines`**: Extract code (functions, helpers, types) to a new module.
**NEVER** trim, compact, or shorten comments/JSDoc to fit the line limit.

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
3. Run `pnpm ops xray --suppressions` to audit; target 0 unjustified items

## Temporal Markers in Code Comments

**No dates, PR numbers, or review-archaeology in code comments** (`//`, JSDoc
`*`, block `/* */`) — keep the invariant, drop the journey: not
`// Added 2026-05-06 to fix data loss` but
`// Required for parity with API schema cap; UI silently truncated otherwise`.
`backlog/**/*.md` is exempt. Archaeology belongs in commit messages, PR
descriptions, post-mortems, and backlog entries.

**Enforcement**: `.husky/pre-commit` scans newly-added comment lines in
`*.ts`/`*.tsx`/`*.js`/`*.jsx` for date stamps, PR refs, and round/review
markers. Override with `TZUROT_SKIP_TEMPORAL_CHECK=1` for the rare intentional
case.

## A Comment That Asserts Behavior Is a Claim

A comment stating what the code _does_ under some condition — "it never
bypasses", "this cannot backtrack", "the retry is idempotent" — gets the same
treatment as a claim in a PR body: **pin it with a test, or say in the comment
that it is unverified.** This applies to the same comment shapes the section
above enumerates.

Trigger: any comment asserting RUNTIME behavior. Certainty words (_never_,
_always_, _cannot_, _is safe_) are the usual tell but not the whole set — a bare
property name ("the retry is idempotent") and a named mechanism's EFFECT ("the
lookahead prevents backtracking") claim just as much. Naming a mechanism alone
does not ("uses a lookahead to skip whitespace"), and neither does
design-structure prose ("cannot be extracted"). Name the test, or hedge in the
comment itself (`// not verified: assumes the caller already acked`).

**A comment explaining code by what a DEPENDENCY does is an external-system
claim** — `00-critical.md`'s probe-first rule applies at the moment you write
the comment, not only when you state the claim in prose. "cac returns the last
value for a repeated flag", "the timeout means it was delivered": probe (a
`--help`, a one-line call) or hedge in the comment. Explaining a shape feels
like documentation rather than assertion, which is exactly why this shape got
past the rule twice in one session.

In CODE files the VALUE half (`never null`, `always populated`, `cannot be
<value>`) is caught mechanically by `claim-shape-guard.sh`, which skips `*.md`
and the `.claude/` tree — so a value claim in prose is this rule's too. The
rest (behavioral, algorithmic, security) is judgment.

## A New Branch Beside an Old One Needs a Two-Way Sweep

Trigger, at AUTHORING time: adding a branch, case, or handler beside an existing
one that classifies the same input. The sibling is the specification — sweep
both directions from the branch point:

- **Outbound** — enumerate every guard, filter, and normalization the sibling
  applies before it acts, and justify each one the new branch omits. Silence is
  not a justification; an omission is either deliberate with a reason or a bug.
- **Inbound** — enumerate which inputs now reach a DIFFERENT branch than before,
  then re-check every comment, docstring, and test written about their OLD
  routing. Adding a branch re-routes inputs without editing a line of the prose
  that describes them, so this half has no other tripwire.

Both halves are mechanically findable from the branch point alone. The
inbound half is the one nothing else in this corpus covers — the Grep Rule
searches for a known pattern, and `/tzurot-bug-remediation`'s class sweep fires
on a BUG, while this class is created while writing new code that works.

## TypeScript Strict Rules

- TypeScript `strict: true`, no `any` types
- Use `unknown` + type guards instead of `any`
- Validate with Zod at service boundaries
- Be explicit: `!== null`, `!== undefined` (no implicit boolean coercion)
- **No unused parameters** — `noUnusedParameters: true` is enforced. If a function no longer uses a parameter, remove it from the signature and update callers. The `_` prefix escape hatch is for cases where you don't control the signature (callbacks, interface implementations, error params) — not for keeping dead parameters "for compatibility."

## Pino Logger Format

Error/fields object FIRST, static message second: `logger.error({ err: error }, 'Failed to process request')`. Single-argument and template-literal forms are ESLint errors.

## Testing Standards

### Test Tiers (canonical: see TESTING.md)

Tzurot uses Toby Clemson's 5-tier model. **The canonical definitions live in one place** — [Test Tier Taxonomy](../../docs/reference/guides/TESTING.md#test-tier-taxonomy). Do not re-define the tiers here or in the skill; link there (`pnpm ops guard:test-taxonomy` enforces the single-sourcing).

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

   **Cover every render MODE, not just the default one.** A branching renderer
   (full vs. deduped, live vs. stored, enabled vs. disabled) leaves its
   non-default arms as untested forwarding paths — enumerate the modes and
   assert the seam in each. When the forwarded value **cost money** (vision,
   transcription, an external fetch), mock the paid boundary to return a
   sentinel and assert the sentinel reaches the final output — a field-parity
   allowlist only catches the field you already know about. Reference: the
   (deduped × full) × (live × stored) matrix in
   `services/ai-worker/src/services/ReferencedMessageFormatter.test.ts`.

   **A shared mutable context is a seam too, with no mock to assert across.**
   Pipeline steps, middleware, and anything handing data to a later stage by
   writing a field on a shared object (`job.data.context`, `req`, an
   accumulating result): each step's unit tests construct that object
   themselves, so neither can observe what the other produced. Whenever a step
   writes a field a later step reads, keep ONE test that runs those steps
   **in order**.

   **The specific tell is a default-coalescing write-back**: `x = ctx.field ??
[]`, `?? {}`, `|| fallback` written BACK onto the shared object erases the
   distinction the later step reads. Where absence carries meaning, say so in a
   comment at the write site and pin BOTH states in the sequencing test —
   absent stays absent, empty stays empty (`??` falls through on `undefined`,
   never on `[]`). Reference:
   `services/ai-worker/src/jobs/handlers/pipeline/steps/extendedContextVisionSeam.test.ts`.

   **The RESPONSE direction crosses a Zod strip no mock can see.** Typed clients return
   `outputSchema.safeParse(...).data`, so a response key not declared in the wire schema
   is deleted before the caller ever sees it — and a mocked client skips that parse. Pin
   survival at the boundary: `Schema.safeParse(payloadWithSentinel)` → assert `result.data` still carries it.

8. **Interface changes must sweep UNTYPED fixtures — and new fixtures should be typed** - When a shared type's shape changes, grep by a distinctive FIELD name in addition to the type name: untyped mock payloads (`vi.fn().mockResolvedValue({...})`) never reference the type, so both a type-name grep AND the compiler miss them — and a fail-soft catch downstream can hide the breakage entirely (a PGLite suite's usage-log writes silently no-oped this way). Prevent the class at authoring time by typing fixture payloads: `mockResolvedValue({...} satisfies ExtractionModelResult)` makes the compiler break the test when the interface moves.

   **The sweep must cover every test TIER, not just the ones a local
   `pnpm test` runs** — `tests/e2e/` (integration + contract) pins producer
   shapes too. Before pushing any cross-service string-shape change (job ids,
   fixture fields, wire formats): (a) grep the OLD shape's distinctive tokens
   repo-wide _including `tests/`_, and (b) run
   `npx vitest run --config vitest.integration.config.ts tests/e2e/contracts/`
   (~2s; the full-`test:integration` OOM ban does not cover this subset).

9. **Prove a new assertion can fail** - before trusting it, mutate the code it covers and confirm the test goes red; a test that passes either way reports coverage while verifying nothing.

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

Schema tests colocate like everything else: `schemas/api/persona.ts` → `schemas/api/persona.test.ts`. Never a separate directory.

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

**Import from source modules, not index files** — `./utils/dateUtils.js`,
never `./utils/index.js`. Re-exports create circular imports and break vitest
mocking.

**Explicit enumeration over opaque sugar in shared infrastructure.** In shared
mocks, factories, and helpers, prefer explicitly listing properties over
`{ ...actual, override }` spreads and `export *` — the reader of shared code
must be able to see which exports are stubbed vs. passed through without
resolving the spread, and explicit enumeration creates compile-time pressure
when the underlying type changes where a spread propagates silently. Sugar is
fine when the alternative is pure repetition with no distinction to track.

**No wrapper re-export files.** Never create a local file that just re-exports
from another package; import directly from the source package.

The `@tzurot/common-types` root barrel was REMOVED — a bare
`from '@tzurot/common-types'` import is an ESLint error
(`no-restricted-imports`). Use deep subpaths
(`@tzurot/common-types/types/jobs`, `@tzurot/common-types/services/prisma`).

## Dependency Additions Land on Latest

When adding a **new** dependency (not bumping an existing one), check `pnpm view <pkg> version` and pin to latest stable — a dep added a major behind starts life needing an upgrade. Keeping deps current afterward is Dependabot's job.

## Python Standards (voice-engine)

Moved to [`services/voice-engine/CLAUDE.md`](../../services/voice-engine/CLAUDE.md) — it loads automatically when working under that directory, which is the only time it applies.

## Duplication, Helpers, and the CPD Ratchet

Raw jscpd output is paired with a post-filter that excludes call-expression-dominant fragments (the "standardized helper call site" false-positive class). Close-out audit: [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../../docs/reference/CPD_CAMPAIGN_AUDIT.md).

### Config-route helpers — scope and boundary

`services/api-gateway/src/utils/configRouteHelpers.ts` + `normalizeConfigNameOnPromote.ts` standardize the CRUD config-route shape: `parseBodyOrSendError`, `findConfigOrSendNotFound`, `findGlobalConfigOrSendError`, `findAdminUserOrSendError`, `ensureNoNameCollision`, `shapeDeleteResponse`, `applyOwnerNamePromotion` (signatures in the file).

**Apply these helpers when:** the route follows the fetch-validate-respond shape over a top-level config row (LlmConfig, TtsConfig, similar future resources).

**Do NOT apply these helpers when:** the route uses cascade-override semantics (`user/{tts,stt,model}-override.ts`). Cascade overrides set/clear values on a personality-scoped key — a fundamentally different domain shape than CRUD. Forcing CRUD helpers there is the Wrong Abstraction trap.

### The 2-callback ceiling rule (when considering new extractions)

Before extracting a new shared helper from a duplicated route pattern, prototype the kernel signature. If the proposed shared function requires **more than 2 callback/predicate parameters** to handle observed divergences across the call sites, **the divergence is structural and the helper should NOT be extracted**. Leave the code inline; duplication is cheaper than the wrong abstraction.

**The adapter-interface exception**: a cohesive INTERFACE whose methods are
authored together per implementor is ONE parameter, not N callbacks — even
with 3+ methods. The test is cohesion: if removing one method makes the others
meaningless, it's an adapter seam; if the functions are independent degrees of
freedom a caller could mix-and-match, the ceiling applies. Precedents:
`TtsProvider`, `EntitySectionAdapter` (cohesive) vs. the rejected
cascade-route "preamble helper" (schema + verify-access + pre-hook =
independent knobs). Adapter IMPLEMENTATIONS live next to their implementor's
code, never in the shared module.

### CPD measurement: raw vs filtered

Commands: `05-tooling.md` § CPD. `pnpm cpd` (raw jscpd) is informational — the
raw count cannot reach zero in a well-abstracted TypeScript codebase;
`pnpm ops cpd:filtered` is the metric that reflects real debt.

**When a clone trips the ratchet, ask first**: new call-site of a shared
helper (likely OK — investigate why the filter missed it) or new copy-paste of
business logic (real debt, fix it)? `pnpm ops cpd:filtered --show-pairs 25`
triages.

**Never raise the baseline to make CI pass.** First do one of: (a) extract the
duplication into a shared helper, (b) confirm the clones are legitimate
skeleton-shape uniformity (2-callback rule), or (c) raise the `cpd:filtered`
threshold if the heuristic is misclassifying. Then
`pnpm ops cpd:update-baseline --dry-run` to preview, and again without it.
