---
id: TASK-1179
title: 'Track GHSA-ch52-4w7c-c8xp (http-cache-semantics, high, no patched version yet)'
status: To Do
assignee: []
created_date: '2026-10-05 13:42'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 1170000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Dependabot alert 176 opened on main right after the beta.234 merge (2026-10-05): http-cache-semantics 4.2.0, transitive, max-stale handling can disclose cross-user cached responses. GitHub lists no first patched version, so no override is possible yet (pnpm-lock.yaml resolves http-cache-semantics@4.2.0).

What: when a patched version publishes, add or widen a pnpm.overrides entry, pnpm install, confirm the lockfile resolves the patched version, and check which dependency pulls it in (and whether any service runs a shared HTTP cache through it, which decides real exposure).

Acceptance: pnpm ops security:advisories shows the alert resolved, or a recorded reason it does not apply.
Promote when: the advisory gains a first patched version.
<!-- SECTION:DESCRIPTION:END -->
