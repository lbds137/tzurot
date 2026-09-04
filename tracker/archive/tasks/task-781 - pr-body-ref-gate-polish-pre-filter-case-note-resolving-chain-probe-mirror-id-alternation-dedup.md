---
id: TASK-781
title: >-
  pr-body-ref-gate polish: pre-filter case note, resolving-chain probe mirror,
  id-alternation dedup
status: To Do
assignee: []
created_date: '2026-08-27 03:23'
updated_date: '2026-09-04 20:00'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 781000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2234 round-6 review left three Low/nit findings at the review-round cap - all one-file polish on .claude/hooks/pr-body-ref-gate.sh, tracked here instead of a seventh CI cycle.

Fix shape: (1) the raw case pre-filter is case-sensitive while the downstream family check is grep -qiE - add a comment stating the asymmetry is deliberate (gh subcommands are lowercase-only) or align them; (2) add the mirror of probe case 24: a chain of 5 RESOLVING ids must NOT block (pins against an over-blocking off-by-one the under-block case cannot see); (3) the (TASK-[0-9]+|doc-[0-9]+) id alternation appears in both REF_PATTERN and the flat IDS extraction - growing the id vocabulary means editing both, so either hoist to one variable or comment the pairing.

Acceptance: probe suite green with the new mirror case; the asymmetry documented or removed; id vocabulary has a single edit point or a paired-edit comment at both sites.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:00
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-781 finds it.
---
<!-- COMMENTS:END -->
