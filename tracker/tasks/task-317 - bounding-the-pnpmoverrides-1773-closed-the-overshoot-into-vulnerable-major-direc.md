---
id: TASK-317
title: pnpm.overrides bounding follow-up (undershoot direction)
status: To Do
assignee: []
created_date: '2026-07-23 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:tooling'
  - 'origin:review'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 317000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-23 (#1773 review, non-blocking) — bounding the pnpm.overrides (#1773) closed the overshoot-into-vulnerable-major direction but opened the INVERSE silent-drift: a future advisory whose fix only lands in the next major (crossing one of the new `<X.0.0` ceilings) is silently blocked — `pnpm install` keeps resolving the old, now-known-vulnerable major until someone manually raises the cap. **Fix shape**: teach `pnpm ops security:advisories` to flag "advisory fix crosses an override ceiling" as a distinct actionable case (separate from the existing "transitive-only, needs manual override bump"), and/or note it in `05-tooling.md`. **Promote when**: an advisory's fix version exceeds one of the override ceilings, or the next `security:advisories` enhancement.

**Why:** The bounding sweep trades one silent-drift failure for another; detection closes the new gap the same way #1768 closed the old one.
<!-- SECTION:DESCRIPTION:END -->
