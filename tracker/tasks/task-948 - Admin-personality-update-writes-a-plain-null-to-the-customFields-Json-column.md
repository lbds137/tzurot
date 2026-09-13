---
id: TASK-948
title: Admin personality update writes a plain null to the customFields Json column
status: To Do
assignee: []
created_date: '2026-09-13 00:36'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 946000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/api-gateway/src/routes/admin/updatePersonality.ts:67-68 assigns validated.customFields straight onto an untyped Record<string, unknown> update object, so an explicit null reaches Prisma as a plain JS null. The user update route mirrors this shape but writes Prisma.DbNull instead, because a Json? column distinguishes SQL NULL from JSON null and the typed Prisma input rejects a bare null at compile time. The admin builder sidesteps that check by being untyped, so the compiler cannot catch it.

UNVERIFIED MECHANISM: this is a code read, not a runtime observation. Whether Prisma throws on a bare null for a Json? field at runtime was never confirmed. Confirming it needs the same PGLite component test the fix would ship with, which is why it was not fixed inline in the PR that surfaced it.

Surfaced while wiring TASK-590 (customFields forwarding on the two user routes). Sibling-flow sweep: admin/createPersonality.ts is fine, it spreads the field only when neither null nor undefined.

Fix shape: mirror the user update route, so a null writes Prisma.DbNull and an object casts to Prisma.InputJsonValue; or type the admin update builder so the compiler catches the class rather than one instance. Pin with a PGLite component test that PUTs an explicit null and reads the column back.

Acceptance: an admin update carrying customFields null clears the column rather than erroring, asserted against PGLite; or, if a runtime probe shows a bare null already works, the finding is recorded as a non-issue with the probe output quoted.
<!-- SECTION:DESCRIPTION:END -->
