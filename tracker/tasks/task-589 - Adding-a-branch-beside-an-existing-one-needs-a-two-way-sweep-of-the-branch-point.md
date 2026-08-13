---
id: TASK-589
title: >-
  Adding a branch beside an existing one needs a two-way sweep of the branch
  point
status: To Do
assignee: []
created_date: '2026-08-13 16:47'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 589000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2089 took five review rounds on a ~200-line change, and four of the five substantive findings were one class. Adding a second classification branch (nonRendering) beside an existing one (resolvable) in parseLinkDestinations produced, in order: the new branch missing the file-shape filter its sibling had (Medium, round 1); missing the fragment strip its sibling had (Medium, round 4); missing the scheme rejection its sibling had (Low, round 4); and a docstring whose example silently began describing the wrong bucket because adding the branch RE-ROUTED an input the prose was written about (Low, round 5).

Each was fixed as reported, which is why it took five rounds instead of one. Every one was mechanically findable at authoring time from the branch point alone.

The existing rules do not cover this. 00-critical Grep Rule is about searching for instances of a known pattern. tzurot-bug-remediation step 3 is a class sweep for a BUG. TASK-588 is a positive control for a grep. None of them fire when writing NEW code that adds a branch beside an old one, which is when this class is created.

Fix shape: a rule with the trigger "adding a branch, case, or handler beside an existing one that classifies the same input", and a two-way sweep. Outbound: enumerate every normalization and guard the sibling applies before it acts, and justify each one the new branch omits. Inbound: enumerate which inputs now reach a DIFFERENT branch than before, and re-check every comment, docstring, and test that describes their old routing. The inbound half is the one with no existing analogue anywhere in the corpus.

Acceptance: the rule names both directions and the authoring-time trigger. Consider whether it belongs in 02-code-standards next to the seam-assertion rules or in 00-critical next to the Grep Rule. Source: 2026-08-13 drain session, self-reported from PR 2089 review rounds 1-5.
<!-- SECTION:DESCRIPTION:END -->
