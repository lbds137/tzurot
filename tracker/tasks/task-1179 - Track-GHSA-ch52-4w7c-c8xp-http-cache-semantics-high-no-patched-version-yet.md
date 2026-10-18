---
id: TASK-1179
title: 'Track GHSA-ch52-4w7c-c8xp (http-cache-semantics, high, no patched version yet)'
status: Done
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

Outcome (2026-10-18, owner ruling): does not apply; alert 176 dismissed as not_used. Parent is astro 7.3.5 (^4.2.0); services/website builds with output 'static' and astro uses the package only in its build-time remote-image cache (dist/assets/build/remote.js), so no deployed service runs a shared HTTP cache through it. 4.3.0 (published 2026-10-04) is NOT a fix: npm diff 4.2.0 to 4.3.0 changes only Vary matching and adds a status accessor, the max-stale path is untouched, and the advisory still lists no patched version. An override to 4.3.0 (PR 2628) was closed because it would have closed the alert mechanically on an unfixed version. A dismissed alert does not reopen by itself, so if a real patched version ships (pnpm ops security:advisories or the advisory page shows first_patched_version), reopen alert 176 and add the override then. Same re-raise if the website ever moves off output 'static' to server rendering.
<!-- SECTION:DESCRIPTION:END -->
