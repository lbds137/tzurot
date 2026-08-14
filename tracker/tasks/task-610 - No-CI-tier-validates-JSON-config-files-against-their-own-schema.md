---
id: TASK-610
title: No CI tier validates JSON config files against their own $schema
status: To Do
assignee: []
created_date: '2026-08-14 16:15'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 610000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: prisma/drift-ignore.schema.json was added so the file its $schema line already pointed at finally resolves. But nothing runs it — not pnpm quality, not CI, not any test — so it is enforced only by an editor that happens to wire up schema validation. Confirmed by grep at filing time: no ajv or schema.json reference anywhere in packages/tooling/src, and ajv is not a direct dependency of the root or any package (transitive only).

Concrete consequence, surfaced by the PR 2101 review: type is a required field on every protectedIndexes entry in the schema, and protectedIndexRegistry.ts never reads it. Deleting type from an entry, or setting it to empty, passes every automated gate untouched. The same hole covers every other schema-only constraint, including the whole ignorePatterns shape.

This is deliberately NOT scoped as "validate type in the loader". That fixes one field and leaves the class open, and the loader validating what it does not consume is the wrong contract — the loader should check what it uses, the schema should describe the format, and something should check the file against the schema.

Fix shape: add ajv as a direct devDependency and a colocated test that validates prisma/drift-ignore.json against prisma/drift-ignore.schema.json, so a malformed entry fails the tooling suite. Consider whether other JSON config in the repo carries a $schema line that is equally unchecked — sweep before deciding whether this is one test or a small shared helper. If it becomes a helper, the enforcement-boundary note in check-migration-safety.WHY.md and the ENFORCEMENT BOUNDARY text in the schema description both need updating, since both currently state that nothing runs the schema.

Acceptance: removing type from a protectedIndexes entry fails a local test run and CI; the two notes above are corrected if the boundary moves.
<!-- SECTION:DESCRIPTION:END -->
