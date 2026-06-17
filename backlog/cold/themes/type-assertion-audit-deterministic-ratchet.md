### Theme: Type-Assertion Audit + Deterministic Ratchet

_Focus: triage the untyped-cast surface and adopt a deterministic gate so new unsafe assertions can't land silently — same shape as the CPD story (noisy raw metric → classifier + ratchet)._

**Surfaced 2026-06-12 (user)** after PR #1192 (the `content as string` fix) — that cast was hiding a real type hole (`buildBaseComponents` returned `{ content: unknown }`, caught by tsc the moment the cast came out). Census of production code (tests excluded): **65 `as unknown as`** double-casts (full type-system bypass; some are test infra under `src/`, but production hits include `ai-worker/jobs/AIJobProcessor.ts` ×3, `bot-client/utils/browse/customIdFactory.ts` ×3, the dashboard settings builders, `fetchTypingChannel.ts`), **1 `as never`** (`settingsUpdateFactory.ts:75`), **~416 total `as Type` assertions** never triaged.

**Scope**: (1) triage the `as unknown as` production set — each is either a legit boundary (document why, à la suppression-justification standards in `02-code-standards.md`) or a latent hole (fix); (2) adopt a deterministic gate so new unsafe assertions can't land silently.

**Tool candidates (training-data priors — REQUIRE live web verification per the research-method convention; verify current names/maturity/vitest-ESLint-version fit before adopting):**

1. **`@typescript-eslint/no-unsafe-type-assertion`** — ESLint rule flagging assertions not provably safe; slots into the existing lint pipeline with a baseline/ratchet like cpd. Likely primary candidate.
2. **`@typescript-eslint/consistent-type-assertions`** — can restrict assertion styles (e.g., forbid `as` outside `as const`).
3. **`type-coverage`** (`--strict` counts type assertions; `--at-least` threshold) — ratchetable in CI like the cpd/test-audit baselines.
4. **ast-grep** for structural search during the triage itself.

The triage pass is cross-cutting (all three services + packages); the ratchet adoption follows the audit-tool checklist (`docs/reference/audit-enforcement.md`) if it graduates to an audit-class gate. Complements the deterministic-test-tooling theme below — both are "make the unsafe thing impossible to land silently." **Promote when**: capacity for a cross-cutting tech-debt campaign exists.
