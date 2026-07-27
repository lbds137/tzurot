---
id: TASK-123
title: 'Required-query-params lose required-ness AND numeric narrowing in generated client…'
status: To Do
assignee: []
created_date: '2026-05-24 00:00'
labels: []
dependencies: []
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Required-query-params lose required-ness AND numeric narrowing in generated client signatures

**Why:** `RouteDef.query` accepts a record of Zod schemas; `buildOptionsType` in `method-builder.ts` widens every key to `{ [key]?: string }` because all HTTP query values are strings on the wire. Two ergonomic gaps for PR-2 callers: (1) **required-ness loss** — for routes where a query param is genuinely required server-side (rejected with 400 if absent), the client signature gives callers no compile-time signal; (2) **numeric narrowing loss** — `z.coerce.number().int().positive().optional()` on the server (e.g., `recentUsers.sinceDays`) narrows to `number` after coercion, but the client signature stays `string?`, so a caller passing `7` gets a TS error and must wrap with `String(7)`. Reviewer's suggested fix shape: add a `requiredQuery` field to `RouteDef` (or a `.required()` marker) that the codegen renders as required positional parameters; optionally inspect schema kind for `z.coerce.number()` to widen the client type to `number | string`. **Why deferred**: closely related to the timeout-escape-hatch backlog item — same `method-builder.ts` / `buildOptionsType` territory, same client-signature-narrowing problem class. Co-fix candidate. No production evidence yet. **Promote when**: PR-2 surfaces a real call site where required-but-optional causes a 400 OR numeric-coerce causes call-site friction, OR opportunistically alongside the timeout-escape-hatch refactor. Surfaced 2026-05-24 by PR #1090 rounds 7+10 claude-bot reviews. Deferred 2026-05-24.
<!-- SECTION:DESCRIPTION:END -->
