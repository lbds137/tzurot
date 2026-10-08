---
id: TASK-1191
title: ProviderRouter z.ai key check reads a bare vi.fn() undefined as a key
status: To Do
assignee: []
created_date: '2026-10-08 14:57'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1181000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: worker-found during TASK-1171 (PR for the guest piggyback footer note). ProviderRouter.ts line ~187 checks userZaiKey !== null; a mock returning undefined (a bare vi.fn() with no mockResolvedValue) passes that check and takes the has-key branch. Production always returns null-or-string, so this is a test-only sharp edge today, but the check shape invites a real undefined leak. What: tighten to a null-and-undefined-safe check (or normalize the resolver contract) and sweep sibling resolvers for the same shape. Acceptance: a test pins the undefined-input behavior; the check cannot confuse undefined with a key.
<!-- SECTION:DESCRIPTION:END -->
