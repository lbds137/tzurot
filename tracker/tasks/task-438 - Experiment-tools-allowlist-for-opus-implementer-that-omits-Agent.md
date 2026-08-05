---
id: TASK-438
title: 'Experiment: tools allowlist for opus-implementer that omits Agent'
status: To Do
assignee: []
created_date: '2026-08-05 11:30'
labels:
  - 'area:process'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 438000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #1971 added a prompt-level no-subagent bullet to opus-implementer; its review pointed out the agent still has full tool access including Agent, and 00-critical prefers structural enforcement over prompt convention. A tools: frontmatter allowlist omitting Agent would make sub-delegation impossible rather than discouraged.
Fix shape: verify first, then apply - an allowlist that accidentally omits a tool workers need (Bash, Read, Edit, Write, Grep, Glob, Skill, ToolSearch, ...) breaks implementation agents quietly mid-task. Spawn a throwaway opus-implementer with a candidate allowlist on a trivial spec and confirm every routinely-used tool still works, then commit the frontmatter change via the review-gated PR path.
Acceptance: either the allowlist ships verified, or the experiment shows the harness cannot express it and the prompt-level caveat is recorded as the accepted state.
<!-- SECTION:DESCRIPTION:END -->
