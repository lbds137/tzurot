---
id: TASK-1506
title: >-
  Codegen: narrow z.enum query params to string literal unions in generated
  clients
status: To Do
assignee: []
created_date: '2026-11-22T04:53:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1506000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2782 claude-review r1 (low). packages/tooling/src/codegen/method-builder.ts:62 (queryFieldType) widens every non-number query schema to string, so z.enum query params such as skipVoices emit skipVoices?: string instead of literal unions. What: inspect unwrapped ZodEnum schemas in queryFieldType and emit the union of string literals in generated client option types, with tests in method-builder.test.ts. Acceptance: z.enum query params emit literal union types in generated client methods and codegen:routes passes.
<!-- SECTION:DESCRIPTION:END -->
