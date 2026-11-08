---
id: TASK-1369
title: Erasure-disclosure copy follow-ups from PR 2725 review round 3
status: To Do
assignee: []
created_date: '2026-11-08T21:11:00Z'
labels:
  - area:bot-client
  - area:docs
  - size:S
  - state:owner
dependencies: []
priority: medium
ordinal: 1352000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2725 (TASK-283) merged at review round 3 with no blockers; five low/nit items remain.

Owner question: should the privacy policy also tell the AFFECTED user that facts tagged with their name may be removed when another user with the same name deletes their account, and name former/renamed names as a persistence case?

Recommendation: yes to both — the policy is the data-rights surface and each is one clause.

Items: (1, owner) affected-party over-erasure sentence in docs/legal/PRIVACY_POLICY.md; (2, owner) add a name you no longer use beside the nickname example (vocabulary is built from current username + current personas, AccountDeletionService.ts buildTagVocabulary); (3) pin the '- Also:' prefix with a toContain in services/bot-client/src/commands/settings/data/delete.test.ts; (4) merge the two adjacent contact-the-operator sentences in the Delete everything bullet; (5) optionally split the ~240-char dialog bullet in delete.ts into two sub-bullets. Acceptance: owner rulings on 1-2 applied or ruled out; 3-5 shipped; policy Last updated bumped if the text changes.
<!-- SECTION:DESCRIPTION:END -->
