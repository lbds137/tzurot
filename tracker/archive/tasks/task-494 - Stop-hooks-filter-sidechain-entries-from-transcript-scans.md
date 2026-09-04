---
id: TASK-494
title: 'Stop hooks: filter sidechain entries from transcript scans'
status: To Do
assignee: []
created_date: '2026-08-09 18:33'
updated_date: '2026-09-04 19:59'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 494000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2031 review — neither promise-ledger-check.sh nor blocking-question-channel-check.sh filters sidechain/subagent entries when scanning the transcript, so a spawned agent could in principle pollute the turn-boundary, formal-channel, or final-text reads. Inherited pattern, now in two files; fail-open direction bounds the damage to a spurious block-once or a missed reminder.
Fix shape: in both hooks python blocks, skip records where isSidechain is truthy (verify the actual field name against a live transcript first — producer is authoritative); add a probe case per hook with a sidechain entry carrying a closing question / promise.
Acceptance: both probes green with new sidechain cases; both hooks ignore sidechain records.

Riders from PR 2031 round-3 review (same files, same probe suites — fold into this PR):
1. Header notes in both hooks documenting event scoping: they are wired to the Stop event only, and Claude Code fires SubagentStop as a separate event, so subagent turns never invoke them (verify against the docs at build time before writing the claim).
2. blocking-question-channel-check: add the "?!"-ending line to the documented false-negative list (trailing punctuation after the question mark defeats the endswith check), or strip trailing !/. — decide at build.
3. Evaluate scoping final_text extraction to the turn slice when a boundary exists (currently last-text-anywhere, inherited from promise-ledger-check) — behavior change, weigh against the lenient-fallback design before applying to both hooks.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:59
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-494 finds it.
---
<!-- COMMENTS:END -->
