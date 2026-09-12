---
id: TASK-887
title: >-
  Orchestration contract: a dispatched orchestrator must bound or avoid
  run_in_background waiters
status: To Do
assignee: []
created_date: '2026-09-04 11:53'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 885000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-09-04 a worktree-isolated orchestrator (the PR 2324 class-sweep round) started a background Bash loop — until grep -q on a file inside its own worktree, sleeping 3 s, stderr silenced — to wait for its inner worker to rebuild a probe case. The orchestrator completed and its worktree was removed by the main loop; the loop kept polling a path that no longer existed for about 55 minutes, invisible to ListAgents, the CI monitors, and git worktree list, until the owner saw it in the Background tasks panel and asked what it was. The harness does not reap a completed subagent background shells (feedback drafted); the contract has to prevent the shape.

Fix shape: one bullet in the nested-dispatch contract points of .claude/skills/tzurot-orchestration/SKILL.md, in the same list as the pwd assertion and the no-SendMessage instruction: an orchestrator never starts a run_in_background shell to wait on its own worker — it waits on the Agent tool result — and any background waiter it does start for an external condition carries a timeout (a bounded loop counter or timeout(1)) and a final line that prints its own exit reason, so the harness panel never shows an unbounded Running row after the agent has reported. Copy the sentence into the dispatch-prompt contract block the main loop pastes into every dispatch. Skills are review-gated: its own PR, or ride the next skill-editing PR.

Acceptance: the skill carries the bullet; the next dispatch prompt written from the template includes it; a grep of the session Background tasks after the next unit shows no Running shell belonging to a completed agent.
<!-- SECTION:DESCRIPTION:END -->

Fourth incident, 2026-09-12, adding a MECHANISM the rows above do not name: a waiter started at 07:52:46 was still running 7h36m later and was reaped by PID after the owner spotted it in the Background tasks panel. Its exit condition was the output file existing AND the awaited vitest process being gone, probed with pgrep -f on the vitest command string — and that pattern is a literal substring of the waiter own command line, so pgrep returned the waiter own PID, kill -0 on itself always succeeded, and the loop concluded the work was still running. It was waiting for itself to die. The awaited run had in fact finished at 07:53, one minute in. So a bound is necessary but not sufficient: a liveness probe whose pattern appears in the probing command argv is true forever, and the same self-match that 00-critical.md bans for pkill -f fails silently here instead of loudly. Any contract sentence should cover the probe shape, not only the timeout.

Re-surfaced by the 2026-09-09 mining run (proposal R8): two more owner-caught orphan incidents in the mined delta (a 55-minute stray from a removed worktree that falsified a nothing-is-running answer; three wait-loops running ~170 minutes until the owner spotted them from a screenshot), and one window where 54 percent of all corpus blocks were a 3-to-5-second poll flood from an orchestrator waiting on its inner worker with run_in_background. Absent by construction under the single-hop driver. The companion skill sentence (a nested orchestrator waits through the Agent tool result, never a background poll loop; any background waiter states its own bound) rides the mining process PR; this task keeps the harness-side and tooling-side remedy.
