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
carrying the same options), so `wc -l` is NOT the metric. `pnpm lint` is the
only arbiter; to see the counted size, force it out with
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

No dates, PR numbers or review-archaeology in code comments; keep the invariant (archaeology goes in commits/PRs). `.husky/pre-commit` blocks new ones in ts/tsx/js/jsx; `TZUROT_SKIP_TEMPORAL_CHECK=1` for the rare intentional case.

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
claim** — harness `core.md` § Don't present speculation as fact (the probe-first rule) applies at the moment you write
the comment, not only when you state the claim in prose. "cac returns the last
value for a repeated flag", "the timeout means it was delivered": probe (a
`--help`, a one-line call) or hedge in the comment.

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

## TypeScript Strict Rules

`_`-prefix an unused parameter only when you don't control the signature (callbacks, interface impls); otherwise remove it and update callers. (tsconfig strict, eslint no-explicit-any, strict-boolean-expressions enforce the rest.)

## Pino Logger Format

Lint-enforced (`eslint.config.js` Pino rules).

## Testing Standards

### Test Tiers (canonical: see TESTING.md)

Tzurot uses Toby Clemson's 5-tier model. **The canonical definitions live in one place** — [Test Tier Taxonomy](../../docs/reference/guides/TESTING.md#test-tier-taxonomy). Do not re-define the tiers here or in the skill; link there (`pnpm ops guard:test-taxonomy` enforces the single-sourcing). Suffix→tier quick reference and the schema-test-≠-contract-test distinction: `/tzurot-testing` § Test File Types.

### Core Principles

1. Test behavior, not implementation
2. Colocated tests - `MyService.test.ts` next to `MyService.ts`
3. **When extracting code to a new file, extract/create the `.test.ts` file too** - Do NOT add `structure.test.ts` exclusions for modules with logic
4. Mock all external dependencies - Discord, Redis, Prisma, AI
5. Use fake timers - No real delays in tests
6. **Tests must be self-contained** - Each `it()` block sets up its own data; never depend on side effects from prior tests. Use `beforeAll`/`beforeEach` in a sub-describe for shared fixtures.
7. **Assert what crosses a mocked seam** - When you `vi.mock` a downstream module/collaborator, at least one test MUST assert the arguments that cross that seam (`expect(mockX).toHaveBeenCalledWith(...)`), not only the orchestrator's return value. A test that mocks the seam it's meant to verify **cannot catch a wiring bug at that seam** — the mocked collaborator returns the same thing whether the caller forwarded the right data or silently dropped it. For a multi-module flow (A → B → C where each is unit-tested with the next mocked), also keep ONE **wiring/seam test** that runs the real chain end-to-end and mocks ONLY the external boundary (network/DB/Redis/model client). Reference: `services/ai-worker/src/services/multimodal/visionFallbackChain.test.ts`. Elaborations (render-mode coverage, shared-mutable-context seams, the RESPONSE Zod-strip seam): `/tzurot-testing` § Seam-assertion elaborations.
8. **Interface changes must sweep UNTYPED fixtures — and new fixtures should be typed** - When a shared type's shape changes, grep by a distinctive FIELD name in addition to the type name: untyped mock payloads (`vi.fn().mockResolvedValue({...})`) never reference the type, so both a type-name grep AND the compiler miss them — and a fail-soft catch downstream can hide the breakage entirely. Prevent the class at authoring time by typing fixture payloads: `mockResolvedValue({...} satisfies ExtractionModelResult)` makes the compiler break the test when the interface moves. The sweep must cover every test TIER, not just the ones covered locally: `/tzurot-testing` § Seam-assertion elaborations.
9. **Prove a new assertion can fail** - before trusting it, mutate the code it covers and confirm the test goes red; a test that passes either way reports coverage while verifying nothing.

### Fake Timers (ALWAYS Use)

Always `vi.useFakeTimers()`; for an expected rejection attach the assertion before advancing timers (`/tzurot-testing` § 2).

### When to Add Tests

| Change             | Unit | Schema      | Component (`.int`)           |
| ------------------ | ---- | ----------- | ---------------------------- |
| New API endpoint   | ✅   | ✅ Required | ✅ If DB/multi-service       |
| New `*.service.ts` | ✅   | If shared   | ✅ For complex DB operations |
| Bug fix            | ✅   | If schema   | If multi-component           |

## Types & Constants

### When to Add to Common-Types

| Content                | Add to Common-Types? | Location                |
| ---------------------- | -------------------- | ----------------------- |
| Value used in 2+ files | ✅ Yes               | `constants/<domain>.ts` |
| BullMQ job payloads    | ✅ Yes               | `types/queue-types.ts`  |
| HTTP API contracts     | ✅ Yes               | `types/schemas.ts`      |
| Service-internal types | ❌ No                | Keep in service         |

### Constant Naming

`SCREAMING_SNAKE` config objects with a JSDoc line per member, always declared `as const`.

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

## Dependency Additions Land on Latest

When adding a **new** dependency (not bumping an existing one), check `pnpm view <pkg> version` and pin to latest stable — a dep added a major behind starts life needing an upgrade. Keeping deps current afterward is Dependabot's job.

## Library traps

- cac number-coerces an all-digit flag value, so SHA flags read raw argv (`rawOptionValue`; precedent `gh:ci-gate`).
- Passing ANY explicit prettier `--ignore-path` drops the implicit `.prettierignore` lookup; name both.
- pino-http attaches the request as a child binding and overrides the parent `req` serializer, so redaction lives in `pinoHttp({ serializers })`, never in `formatters.log`.
- The vision cache serves the model-agnostic POSITIVE entry before any tier's negative entry. An integration test of the cached-refusal advance primes the negative entry via `storeFailure` and runs one pass.
- An inspector-side BullMQ queue must mirror the live queue's job options on every `add` (options are per-instance).

## Duplication, Helpers, and the CPD Ratchet

### Config-route helpers — scope and boundary

Moved to `/tzurot-reuse-scout` § Config-route helpers — scope and boundary.

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

`pnpm ops cpd:filtered` is the metric (raw `pnpm cpd` is informational). A tripped ratchet: extract, confirm skeleton-shape uniformity (2-callback rule), or fix the filter; never raise the baseline to pass. Triage: `cpd:filtered --show-pairs 25`.
