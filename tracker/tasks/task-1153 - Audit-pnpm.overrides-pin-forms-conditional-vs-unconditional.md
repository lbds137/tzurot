---
id: TASK-1153
title: Audit pnpm.overrides pin forms (conditional vs unconditional)
status: To Do
assignee: []
created_date: '2026-10-01 18:44'
labels:
  - 'area:deps'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1145000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The overrides block mixes forms: unconditional pins (undici ^6.28.1, ioredis ^5.11.1) keep applying past the CVE window and can silently pin below latest, while conditional triggers (pkg@<bad) expire once upstream moves - but can go stale in the other direction (fast-uri's trigger stopped matching at 4.1.3, incident 2026-10-01). Decide the form per class and sweep the block: security-floor pins probably want unconditional + a periodic advisories check (already at every release preflight); range-constraint pins want conditional. Promote when: next time the overrides block is touched, or the next preflight flags a silently-stale trigger.
<!-- SECTION:DESCRIPTION:END -->
