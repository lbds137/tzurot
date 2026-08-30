---
id: TASK-832
title: >-
  composeGenerationFailureResult re-parses ApiError instances, discarding the
  deliberate cache-hit sentinels
status: To Do
assignee: []
created_date: '2026-08-30 17:51'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 832000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by claude-review on PR #2259 and verified at source before filing. services/ai-worker/src/jobs/handlers/pipeline/steps/generationFailureResult.ts:83 calls parseApiError(underlyingError) unconditionally, with no instanceof ApiError guard. parseApiError regenerates the reference id unconditionally at services/ai-worker/src/utils/apiErrorParser.ts:554 (const referenceId = generateErrorReferenceId()) and re-derives category and userMessage by pattern-matching the message text.

Consequence: the sentinels LLMInvoker.ts deliberately sets on its cache-hit short-circuit paths — referenceId: "rate-limit-cache-hit" (:324) and "credit-exhaustion-cache-hit" (:443) — never survive into the diagnostic embed. They are silently replaced by a fresh random base36 id, and the trusted classification already computed is thrown away in favour of re-pattern-matching. The comment at LLMInvoker.ts:315 states these sentinels exist to be traceable in logs and UX, so their stated purpose is quietly defeated.

The contrast that makes this clearly a bug rather than a choice: shouldRetryError in the SAME parser file special-cases instanceof ApiError at apiErrorParser.ts:645, and its own comment explains the reason is that re-parsing through parseApiError would discard the override. The same discarding applies here; the guard was just never mirrored.

Not a security issue: the freshly generated id is still base36-only, so the /inspect masked-link guarantee that PR #2259 established is unaffected. This is a diagnosability defect.

Fix shape: mirror the shouldRetryError guard — in composeGenerationFailureResult, check instanceof ApiError before parsing and reuse the already-computed referenceId, category, and userMessage rather than re-deriving them. Pin with a test asserting a cache-hit ApiError keeps its sentinel referenceId through to the composed result.

Acceptance: an ApiError carrying a cache-hit sentinel reaches the diagnostic embed with its referenceId and category intact; a plain Error still parses as it does today; and the test canaries against the unguarded version.
<!-- SECTION:DESCRIPTION:END -->
