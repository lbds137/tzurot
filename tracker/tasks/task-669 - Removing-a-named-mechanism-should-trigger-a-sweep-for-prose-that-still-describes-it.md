---
id: TASK-669
title: >-
  Removing a named mechanism should trigger a sweep for prose that still
  describes it
status: To Do
assignee: []
created_date: '2026-08-19 01:46'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 669000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three consecutive PRs in one session (2145, 2146, 2147) produced review findings whose ONLY defect was prose I wrote, and the worst instance was PR 2147: the diff deleted the isMainCutBranch topology test, and left three comments still describing it -- including one telling the reader that the caller "falls back to branch topology", pointing at a mechanism that same diff removed. Zero logic findings across all three.

A memory entry (sweep-prose-when-a-premise-changes) already exists and says exactly what to do: grep the OLD claim tokens when a premise changes. It did not fire, three times. When a written rule has been read and skipped that often, the mechanism is wrong, not the reader -- 00-critical Fix Recurring Failures Structurally puts this at question 3, a hook, because the trigger is deterministic and the correction mechanical.

What makes this hookable where the general case is not: the trigger is not "a premise changed" (unjudgeable) but "this diff REMOVED a named identifier" (mechanical). A removed export, function, const or type has a name, and that name is greppable across comments and docs.

Fix shape:
- pre-commit or pre-push, over the staged diff. Extract identifiers from REMOVED lines matching the declaration shapes -- export function X, function X, const X =, type X =, interface X, class X.
- For each, grep the repo for the identifier OUTSIDE the staged diff, restricted to comment lines and markdown, since a surviving CODE reference is a compile error the compiler already catches and is not this hook business.
- Report the hits and require acknowledgement. Warning first while the false-positive rate is measured -- a renamed-not-removed symbol will fire, and so will a name that is a common English word.
- Colocated probe per the hook-probes registry (packages/tooling/src/dev/check-hook-probes-registry.ts), which is bidirectional and will demand one.

Sibling tasks, same family -- read them before designing, and consider whether one shared extraction serves several: TASK-653 (numeric claims in a PR body, merge-time), TASK-547 (completion claims at PR-body time), TASK-520 (external-system claims in code comments). This one is the removal case and is the only one whose trigger is a pure diff-shape.

Acceptance: deleting an exported symbol whose name still appears in a comment elsewhere produces a hook message naming the file and line; the probe covers both the firing and the silent case; the false-positive rate is measured over a handful of real commits before the hook is promoted from warning to blocking.
<!-- SECTION:DESCRIPTION:END -->
