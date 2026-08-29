---
id: TASK-828
title: >-
  Dispatch specs omit the sibling-guard sweep — two spec-origin defects in one
  session
status: To Do
assignee: []
created_date: '2026-08-29 22:19'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 828000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two review-caught defects on 2026-08-29 shared one shape, and both originated in the DISPATCH SPEC rather than in worker execution. In PR #2253 the spec added an options.startTime path beside the existing orphan-sweep arm and did not carry the sibling clock handling, breaking a documented 40-minute ceiling. In PR #2255 the spec described the routedModel comparison as !isSameModel(routedModel, served) while the sibling substituted check three lines above guards on served.length > 0 first, so an empty modelUsed would render a routing claim the code cannot know. Neither was a worker error; the workers implemented what the specs said.

The rule already exists and was violated, so another rule restating it is worthless. See .claude/rules/02-code-standards.md section A New Branch Beside an Old One Needs a Two-Way Sweep, outbound half: enumerate every guard, filter, and normalization the sibling applies before it acts, and justify each one the new branch omits. That rule names AUTHORING time as its trigger, which lands on whoever writes the edit. Under nested dispatch the branch is DESIGNED in the spec and merely typed by the worker, so the trigger moment moves upstream to a surface that has no section for it: the spec template in .claude/skills/tzurot-orchestration/SKILL.md enumerates Task, Files in scope, Budget headroom, Landmines, Authorized routine decisions, Stop conditions, Verification gates, Branch setup, Report requirements — none of which asks what the new branch sits beside.

Fix shape: add one requirement to the spec templates Task section (or a short numbered item beside the premise ledger) — when the unit adds a branch, case, or handler beside an existing one that classifies the same input, the spec must name the sibling by file:line and enumerate the guards it applies, with the new branch either matching them or the spec stating why not. Keep it to a few lines; the always-loaded budget is near its limit and the orchestration skill is already long. Consider whether the report requirements should also ask the orchestrator to confirm the sweep ran, since the orchestrator is the fresh reader positioned to catch a spec-level omission.

This is agent-generated process work, filed as such against the session drain net.

Acceptance: the orchestration spec template requires a sibling-guard enumeration for any branch-adding unit; the requirement names the existing 02-code-standards rule rather than restating its content; and the change lands via a review-gated PR since .claude/skills is load-bearing.
<!-- SECTION:DESCRIPTION:END -->
