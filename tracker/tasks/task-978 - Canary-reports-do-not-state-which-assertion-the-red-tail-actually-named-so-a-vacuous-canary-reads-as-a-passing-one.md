---
id: TASK-978
title: >-
  Canary reports do not state which assertion the red tail actually named, so a
  vacuous canary reads as a passing one
status: To Do
assignee: []
created_date: '2026-09-14 15:19'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 974000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2422 ran six review rounds with zero correctness bugs found in the shipped code, and every substantive finding was an assertion that outran its evidence: a PR body claim about the prod-yes ordering, a test comment generalizing past its own fixture, three canaries whose stated target differed from the assertion their red tail actually named, and a security guarantee asserted in two doc comments before the code made it true. Existing coverage: 02-code-standards covers behavioral comments and pr-body-ref-gate covers PR body lines (it caught two on that PR). What has NO coverage is the canary half. A canary has a stated claim and a red tail naming some assertion, and nothing checks the two match, so a canary can redden for a structural reason (a TypeError from a broken call chain, a different test entirely) and still be reported as pinning the claim. Three of the six were exactly that, including one where removing a registration broke the whole file rather than failing the new assertion. Fix shape: extend the orchestration spec template and tzurot-review-response so every reported canary states the assertion its red tail named AND whether it was isolated, and flag when that differs from the claim it was derived from; then consider whether dispatch-spec-ledger-gate can check the pairing mechanically. Acceptance: a canary that reddens on something other than its named assertion is visibly wrong in the report rather than plausible.
<!-- SECTION:DESCRIPTION:END -->
