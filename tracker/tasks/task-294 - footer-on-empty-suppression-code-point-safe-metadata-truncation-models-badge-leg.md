---
id: TASK-294
title: 'Browse polish: footer-on-empty, code-point truncation, badge legend'
status: To Do
assignee: []
created_date: '2026-07-18 00:00'
updated_date: '2026-09-04 19:40'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 294000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-18 (#1709 r3/r4 observations; items a–c SHIPPED in PR-4b-2b — footer-on-empty suppression, code-point-safe metadata truncation, models badge-legend completion) — remaining item: **browse pagination failure is silent** — deferUpdate then keep-current-view on fetch failure is the deliberate cross-surface pattern (character-browse-documented), but an ephemeral error followUp is the D-family answer; decide ONCE at the builder/catalog level, not per surface. **Promote when**: the epic's error-state/catalog pass, or the next browse-pagination touch.

**Why:** The pattern is consistent today, just silently so — the decision deserves one deliberate call, not six drifting ones.

**DECIDED 2026-08-14 (owner, TASK-599 digest): ephemeral error follow-up, decided ONCE at the builder level; implement at the next browse-builder touch.**
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Items a-c already shipped (struck through in the task). Remaining item (silent browse-pagination failure) has an owner DECISION already recorded (2026-08-14, TASK-599 digest): ephemeral error follow-up, decided once at the builder level, to implement at the next browse-builder touch. This is a concrete, actionable, already-scoped remaining unit — strong keep, not yet implemented. Evidence: `cat` the task file — decision text present; no code check needed since the decision itself is the current state (not yet built, per its own "implement at next touch" framing and no shipped-marker on this remaining item).
---

author: digest-pass
created: 2026-09-04 19:40
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER-DECIDED, UNBUILT (Shape 14). Carries a recorded owner decision; only implementation remains. Promoted to priority medium so it runs in one of the two decided-work drain batches rather than waiting on an opportunistic trigger that has not fired.
---
<!-- COMMENTS:END -->
