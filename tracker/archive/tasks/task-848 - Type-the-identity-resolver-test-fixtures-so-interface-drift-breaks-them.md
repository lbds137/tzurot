---
id: TASK-848
title: Type the identity resolver test fixtures so interface drift breaks them
status: To Do
assignee: []
created_date: '2026-08-31 23:52'
updated_date: '2026-09-04 20:06'
labels:
  - 'area:identity'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 848000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PersonaResolver.test.ts (and its siblings in packages/identity) build Prisma mock payloads as bare object literals fed to a mockPrismaClient that is cast `as any` at construction. Nothing type-checks them. If the Persona or User row shape changes, these fixtures neither fail to compile nor fail at runtime — the tests keep passing against a shape that no longer exists. That is the exact drift-blind class 02-code-standards.md item 8 names ("Interface changes must sweep UNTYPED fixtures"), and the reason the rule asks for `satisfies` on new fixture payloads.

Surfaced by claude-review on PR #2284, which correctly scoped it as consistent with the file existing convention rather than introduced by that diff. Filed on merits, not on origin: the deficiency is real whoever wrote it.

Fix shape: give mockPrismaClient a real type instead of `as any`, then annotate each fixture payload with `satisfies` against the matching Prisma payload type. Half-doing it (typing only new fixtures while the rest stay untyped) buys nothing — drift would still slip through the untyped ones — so this is a whole-file pass, which is why it was not ridden along on a mutation-coverage slice.

Scope: packages/identity/src/resolvers/PersonaResolver.test.ts first; check whether UserService.test.ts and PersonalityLoader.test.ts share the pattern and sweep them in the same pass if so.

Acceptance: mockPrismaClient carries a real type; every fixture payload in the swept files is `satisfies`-annotated; changing a field name in the Prisma type breaks the test file at compile time (verify by doing it once and observing the error).

CONFIRMED INSTANCE, with the drift already realized (claude-review on PR #2288, slice 4B). Add PersonalityService.test.ts to the sweep scope above: its pre-existing fixtures set flat fields — temperature, topP, topK, frequencyPenalty, presencePenalty, maxTokens — directly under `llmConfig`, but mapLlmConfigFromDb reads none of them; it reads model, provider, contextWindowTokens and the advancedParameters JSONB. So those fixture fields are silently ignored, and the tests using them have been passing against a shape the mapper does not consume. This is no longer the hypothetical "if the row shape changes" case in the Why paragraph — it is that failure having already happened and gone unnoticed, which is the strongest available argument for this task. The new fixtures added in PR #2288 (linkedLlmConfig) use the shape the mapper actually reads; the legacy ones around them do not, so the file is now internally inconsistent as well as untyped.

The reviewer claim above was independently verified rather than taken on faith — mapLlmConfigFromDb (packages/common-types, imported by PersonalityDefaults.ts:10 and PersonalityLoader.ts:12) returns exactly `{ model: raw.model, provider: raw.provider, ...converted, contextWindowTokens: raw.contextWindowTokens }`, where `converted` comes from `safeValidateAdvancedParams(raw.advancedParameters)`. No flat sampling field is read. Re-read it before sweeping anyway: the mapper is where the authority lives and this note will age.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:06
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-4 (Theme Deterministic Test Quality Tooling mutation testing job payload contract); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-848 finds it.
---
<!-- COMMENTS:END -->
