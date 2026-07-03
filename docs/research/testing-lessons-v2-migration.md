# Testing Lessons: V2 → V3 Migration

> **Date**: 2025-11 (distilled 2026-07)
> **Source**: V2→V3 testing retrospective + the Discord.js mock-architecture iteration journey.
> Full 1,071-line original: `docs/reference/architecture/TESTING_LESSONS_LEARNED.md` (deleted; in git history)
> **Status**: Historical rationale. Current procedures are canonical in
> [`docs/reference/guides/TESTING.md`](../reference/guides/TESTING.md) — this note records WHY those patterns won.

## TL;DR

V2 (Jest + JS + heavy mocking) proved that mocking discipline, fake timers, and behavior-first
testing work — and that preset magic, separated test directories, and `as any` mocks rot.
V3's patterns (explicit typed mock factories, co-located tests, Vitest fake timers,
integration-weighted strategy) were chosen specifically as antidotes. The most durable
unique lesson is the **pragmatic mock pattern for complex external libraries** (Discord.js).

## Why V3's testing patterns look the way they do

| V3 pattern                                                    | The V2 failure it answers                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Explicit mock factories (`createMockPersonalityService(...)`) | V2's `presets.commandTest()` magic — nobody knew what was mocked; tests became black boxes                          |
| Typed mocks, no `as any`                                      | V2 mocked a method that didn't exist on the real object (`getAllReleases`); shipped a production bug                |
| Co-located `*.test.ts`                                        | V2's parallel `tests/` tree drifted from `src/`; tests silently stopped being written                               |
| Constructor injection, no DI framework                        | V2's DDD bootstrap required global mocks just to break import cycles                                                |
| Fake timers by default (Vitest built-in)                      | Worked in V2 (~14s suite) — kept, with built-ins instead of custom injectable timers                                |
| Integration-weighted ("testing trophy")                       | Microservices; a unit-only pyramid misses cross-service seams (now formalized as the 5-tier taxonomy in TESTING.md) |

## Pragmatic mocking of complex external libraries (Discord.js)

Discord.js resists typed mocking: readonly properties, type predicates (`this is T`),
template-literal return types (`` `<@${string}>` ``), deep unions. Three "proper" approaches
failed in sequence (~4.5h total): `vitest-mock-extended` (readonly conflicts), a `Mockable<T>`
mapped type (Object.prototype method conflicts — `toString(): string` vs `` toString(): `<@${string}>` ``),
and a function/non-function `MockData<T>` split (23 build errors; `vi.fn()` can't satisfy
type-predicate signatures). The pattern that shipped in ~1h:

```typescript
export function createMockTextChannel(overrides: Partial<TextChannel> = {}): TextChannel {
  const id = overrides.id ?? '444444444444444444';
  const defaults = {
    id,
    name: 'general',
    // Plain arrow functions — not spied on, fully type-safe
    toString: () => `<#${id}>`,
    // @ts-expect-error -- Type predicates cannot be replicated by vi.fn(); runtime behavior is correct
    isThread: vi.fn(() => false),
    send: vi.fn().mockResolvedValue(null),
  } as Partial<TextChannel>;
  return { ...defaults, ...overrides } as unknown as TextChannel;
}
```

Rules of the pattern:

1. **Ask "do I need to spy on this method?"** No → plain arrow function (type-safe, simple).
   Yes → `vi.fn()`, with `@ts-expect-error` + reason comment only where the type system
   genuinely can't express it (type predicates, template-literal returns).
2. **`Partial<T>` for overrides, `as unknown as T` for the final assertion.** Honest about
   being a partial object; the tests are the safety net for sufficiency.
3. **`@ts-expect-error` ≠ `as any`.** It's scoped to one line, documents why, and self-heals
   (build fails if the error disappears). `as any` silences everything forever.

Over-engineering red flags — stop and simplify when you hit any of these:

- More than ~50 lines of utility types to support a mock
- Conditional types with 3+ branches
- Type errors you can't explain
- More than ~1 hour on mock type gymnastics
- Tests pass but the build fails on mock-internal code

The principle: **mocks only need to be good enough for the tests they serve.** Type safety is
valuable where it catches real mismatches (mocking nonexistent methods) and harmful where it
blocks shipping (perfectly typing a library's internals).

## Promise rejections with fake timers

The pattern (attach the `expect(promise).rejects` handler BEFORE `vi.runAllTimersAsync()`)
is canonical in TESTING.md § "Testing Promise Rejections with Fake Timers" and
`.claude/rules/02-code-standards.md`. Historical note: it was discovered here — green tests
with 4 `PromiseRejectionHandledWarning`s on the retry/timeout utilities; two intuitive fixes
(try/catch + `expect.assertions`, wrapper-function) both failed because the rejection fires
during timer advancement, before any late-attached handler exists.

## Durable principles

1. **Test behavior, not implementation** — carried straight over from V2; survived both stacks.
2. **Tests passing is ground truth for mock adequacy** — TypeScript complaints about mock
   internals are noise; mismatches with production usage are signal.
3. **Consult when stuck >30–60 min on type gymnastics** — three external consultations broke
   the Discord.js analysis-paralysis loop; the third ("your tests pass; ship") saved hours.
4. **Magic abstractions rot faster than duplication in test infrastructure** — prefer an
   explicit factory per service over a clever shared preset.
