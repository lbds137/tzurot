---
id: TASK-848
title: Type the identity resolver test fixtures so interface drift breaks them
status: To Do
assignee: []
created_date: '2026-08-31 23:52'
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
<!-- SECTION:DESCRIPTION:END -->
