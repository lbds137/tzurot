---
id: TASK-1315
title: >-
  Dispatch skills never consult lane-meters, so sessions without it route
  implement work to plan subagents instead of agy
status: Done
assignee: []
created_date: '2026-10-28T12:40:00Z'
updated_date: '2026-10-28T16:19:00Z'
labels:
  - area:skills
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1298000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Deck driver-eval read (10-28, dev-docs 04e6610): on Tue 10-27 lane-meters --for implement said agy gemini all day, yet the PR 2674-2677 rounds went to plan Sonnet/Haiku subagents (12.9M weighted).

Finding (transcript audit 10-28): drift, not a deliberate choice. Per Tue session: 711a7bac and c2341372 ran lane-meters (1 and 3 calls) and launched agy (18 and 20 launch commands, TASK-1293/1304/1280/1307 and TASK-981 r1-r4, all exit 0); 75e6f6b5, 625473e5, 904f154e and 626cbb30 ran lane-meters zero times and dispatched only Agent-tool subagents (2 haiku, 2 sonnet, 8 sonnet, 8 sonnet + 1 haiku). No sensitive-file blocker: the switched rounds edited packages/tooling/src/secrets, the same files agy had edited in TASK-981 r1-r4. The switch happened at the 19:54Z /clear: the fresh session went straight to seyag:implementer with no stated lane reason. 75e6f6b5 (PR 2674) used haiku implementers after dispatch-posture-gate blocked inline edits, also without a lane check.

Root cause (structural): neither .claude/skills/tzurot-orchestration/SKILL.md nor .claude/skills/tzurot-review-response/SKILL.md mentions agy or lane-meters (grep -c lane-meters = 0 in both); the orchestration skill prescribes Agent-tool workers. The lane posture lives only in the session-start hook output and the role file Charter, which a post-clear session does not act on unless prompted. The role file also lists an "agy orchestration-skill rewrite" as filed, but no tracker/backlog entry exists; this task is that entry.

Acceptance: the dispatch step in tzurot-orchestration (and review-response section 3a) runs lane-meters --for implement and follows its how-line, with Agent-tool subagents only when the meter says anthropic or agy is refused/stalled (agy-worker exit 5) or the edit is in a class headless workers cannot touch (.claude/hooks, skills, rules, .github); the chosen lane and reason are logged per dispatch. Requires a PR (.claude/skills).
<!-- SECTION:DESCRIPTION:END -->
