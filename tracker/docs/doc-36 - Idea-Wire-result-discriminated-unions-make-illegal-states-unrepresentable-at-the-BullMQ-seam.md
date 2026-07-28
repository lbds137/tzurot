---
id: doc-36
title: >-
  Idea: Wire-result discriminated unions (make illegal states unrepresentable at
  the BullMQ seam)
type: other
created_date: '2026-07-28 11:11'
---

## Wire-result discriminated unions (make illegal states unrepresentable at the BullMQ seam)

The test-quality theme's candidate-4 audit (2026-07-06) found one coherent family: every cross-service RESULT shape is `success: boolean` + all-optional payload fields — the compiler cannot reject `{ success: true }` with no content, nor `{ success: false }` with no error. The type-level fix is the ContextVariant treatment: discriminated unions on `success` with per-arm required fields.

**The family** (all in common-types):
- `AudioTranscriptionResult` (jobs.ts) — success arm requires `content`; failure arm requires `error` and owns `failureReason` (its own doc already says "set only when success=false" — an invariant the type should carry)
- `ImageDescriptionResult` (jobs.ts) — success arm requires `descriptions`
- `LLMGenerationResult` (schemas/generation.ts:183, Zod) — same treatment via `z.discriminatedUnion`
- `ShapesImportJobResult` / `ShapesExportJobResult` (shapes-import.ts) — same pattern, lower traffic
- **Bundle-with**: the `llmGenerationContextSchema` superRefine (jobs.ts:410) converts to `z.discriminatedUnion('kind', ...)` naturally WHEN the legacy tolerance retires — same touch as the existing follow-ups row (the `.default('legacy')` on the discriminator is what blocks it today).

**Why it matters**: these shapes cross the BullMQ seam that produced #1184; the contract suite now pins their runtime behavior, but a union makes the producer-side mistakes uncompilable rather than merely caught. Consumers' `if (result.success)` narrowing improves for free.

**Effort**: medium — the interfaces are consumed across ai-worker handlers/DependencyStep and bot-client result paths; each arm-split surfaces every call site that fabricates partial results (mostly tests). One shape at a time is the right grain; `AudioTranscriptionResult` first (it has the documented-but-unenforced `failureReason` invariant). Promote when: any functional touch of jobs.ts result shapes, or as a standalone chore slice.

