---
id: TASK-931
title: >-
  Retention eligibility scope binding relies on a parenthesization convention a
  new call site can break
status: To Do
assignee: []
created_date: '2026-09-10 15:58'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 929000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: discordIdScope in services/api-gateway/src/services/retention/eligibility.ts appends AND u.discord_id = ANY(...) after a predicate fragment, and it binds to the WHOLE predicate only because each caller wraps the fragment in parentheses (WHERE (${ELIGIBILITY_CONDITIONS}) ${discordIdScope(allowlist)}). ELIGIBILITY_CONDITIONS carries a top-level OR group, so a fourth call site that drops the parentheses would scope only part of the predicate and let a non-production purge reach accounts outside OUTBOUND_DM_ALLOWLIST. The unparenthesized form existed in the first draft of #2385 and was caught in review before its first push. Today all three call sites (selectEligibleUsers, countEligibleUsers, selectNotifyCohort) wrap correctly, pinned by the real-SQL component test in RetentionPurgeService.component.test.ts (narrows the purge cohort by an explicit scope allowlist in SQL).
Fix shape: replace discordIdScope with a helper that takes the predicate fragment and the allowlist and returns the wrapped, scoped SQL itself, so a caller cannot omit the parentheses. Not a callback parameter, so the 2-callback ceiling does not apply.
Acceptance: no call site composes a predicate fragment with a scope clause by hand; the component test above still passes; a mutation that drops the wrapping inside the helper turns it red.
<!-- SECTION:DESCRIPTION:END -->
