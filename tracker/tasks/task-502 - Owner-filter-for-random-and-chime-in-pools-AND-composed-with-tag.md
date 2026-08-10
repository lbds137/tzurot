---
id: TASK-502
title: Owner filter for /random and /chime-in pools (AND-composed with tag)
status: To Do
assignee: []
created_date: '2026-08-10 01:50'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 502000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner follow-up idea (2026-08-09, during the doc-60 smoke): filter the random/chime-in pools by character owner, alongside the shipped tag filter. Decision RECORDED at filing: multiple filters NARROW (AND) - matches the shipped precedent (resolveCharacterSlug documents exclude-private/only-mine/tag as AND conjunctions), the natural reading (tag:fantasy owner:@Alice = that owners fantasy characters), and faceted-search convention. OR was considered and rejected.
Fix shape: add an owner option (Discord user-option - native mention picker, no autocomplete needed) to /random and /chime-in tag flows; filter the cached accessible pool by ownerDiscordId (already on PersonalitySummary); compose AND with tag/exclude-private; empty-pool detail names the owner filter like it names the others. Reconcile with only-mine: owner:@me makes only-mine redundant - decide keep-as-shorthand vs remove (no-backward-compat project, but UX call). Accessible-pool scoping already prevents surfacing another users private characters. Component snapshots will change (new options).
Acceptance: /random tag:x owner:@y picks only within the intersection; /chime-in tag:x owner:@y fans out within it; seam tests per Core Principle 7; the only-mine reconciliation decided and noted in the PR.
<!-- SECTION:DESCRIPTION:END -->
