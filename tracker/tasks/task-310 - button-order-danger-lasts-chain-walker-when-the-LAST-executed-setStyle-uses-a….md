---
id: TASK-310
title: button-order-danger-last walker gap on variable setStyle args
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'origin:review'
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 310000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1740 r2 observation) — `button-order-danger-last`'s chain walker: when the LAST-executed `.setStyle(...)` uses a non-literal argument (ternary/variable) while an EARLIER call in the same chain used a literal `ButtonStyle.Danger`, the walk skips the unresolvable outer call and classifies from the stale overridden literal — the runtime style is actually unknown. Not live anywhere today (the one dynamic-style site calls setStyle once). **Fix shape**: on the first-visited (last-executed) setStyle hit, if the argument is non-literal, mark the whole chain unresolvable (return null) instead of falling through; + a pin test. **Promote when**: the double-setStyle-with-dynamic-last shape appears in the codebase, or the rule produces a confusing false positive.

**Why:** Guard precision on a shape that doesn't exist yet; the fix is 3 lines when the trigger fires.
<!-- SECTION:DESCRIPTION:END -->
