---
id: TASK-1409
title: >-
  security:advisories direct+transitive misclassifies a stale lockfile on a
  direct dep whose range admits the vulnerable version
status: To Do
assignee: []
created_date: '2026-11-12T18:51:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1390000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the beta.243 security preflight classified fast-xml-parser GHSA-474x-hrwr-fgx4 (LOW) as direct+transitive with the remediation "direct deps are patched but a transitive copy still resolves vulnerable" (advisories.ts:446) — but the single workspace declaration was `^5.11.2` (services/ai-worker/package.json:33), which ADMITS the vulnerable version. Nothing was already patched: the real state was a stale lockfile specifier on a direct dep (resolved 5.11.2; the range admits 5.12.0), and the correct fix was a normal declaration bump to `^5.12.0`, not a pnpm.overrides entry (PR #2744 round-1 review, finding 2 — the reviewer inferred it, the driver verified it against the code before acting).

What: classifyScope (packages/tooling/src/audits/advisories.ts:384-395, the TASK-927 fix) checks declared-NAME membership plus whether any RESOLVED version sits in the vulnerable range, and never reads the declared RANGES. It therefore conflates two shapes: (a) every declared range EXCLUDES the vulnerable versions while a transitive copy resolves vulnerable — the true override trap (TASK-927's sharp case, current wording correct), and (b) a declared range ADMITS the vulnerable version with a stale lockfile specifier — a normal direct bump / lockfile refresh, which Dependabot's next dependency bump covers; no override belongs in root package.json. The recommendedAction string asserts "direct deps are patched" without ever checking them.

Fix shape: in classifyScope, inside the stillVulnerable branch, additionally test each declared range (the workspace package.json parse that already builds directNames) against the vulnerable range. Every range excludes it → keep direct+transitive and the override wording. Any range admits it → fourth shape (e.g. `direct-stale-lockfile`) with remediation like "normal bump to >=X (the declaration range already admits the fix); override not needed". Extend the per-shape cases in packages/tooling/src/audits/advisories.test.ts.

Acceptance: the pre-#2744 fast-xml-parser shape (`^5.11.2` declared, 5.11.2 resolved, range `<=5.11.2`) prints the normal-bump remediation, not the override line; the TASK-927 sharp shape still prints the override line; a purely-direct and a purely-transitive advisory keep their current wording; all four pinned in advisories.test.ts.
<!-- SECTION:DESCRIPTION:END -->
