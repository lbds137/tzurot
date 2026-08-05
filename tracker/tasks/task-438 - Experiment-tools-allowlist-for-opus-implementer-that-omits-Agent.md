---
id: TASK-438
title: 'Experiment: tools allowlist for opus-implementer that omits Agent'
status: To Do
assignee: []
created_date: '2026-08-05 11:30'
updated_date: '2026-08-05 12:46'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:dependent'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EXPERIMENT RUN 2026-08-05 (three live probes, all in one session; probe edits reverted, nothing committed). Findings: (1) docs claim agent frontmatter supports both a tools: allowlist and a disallowedTools: denylist with live file-watching — the denylist would be the zero-maintenance shape (new harness tools still inherit). (2) BOTH fields were ignored in live spawns: with disallowedTools: Agent, Workflow set, the worker still had Agent fully loaded; with a 9-tool tools: allowlist set, the surface was byte-identical to the unrestricted default (Agent present, full deferred+MCP sets). (3) Root cause isolated by a marker probe: a body edit to the definition did NOT reach a subsequent spawn — definitions are CACHED AT SESSION START in this harness, so in-session edits are invisible and both tool-field probes were vacuous, not negative. The doc claim of live re-reading is falsified for this environment. (4) Workflow is absent from subagent surfaces inherently (not in the subagent baseline), so only Agent needs blocking. NEXT STEP (requires a FRESH session, cannot be done in-session): at session start, apply disallowedTools: Agent (preferred), spawn a minimal enumeration probe (list tools; is Agent present; does ToolSearch select:Agent return a schema). If ignored, try tools: allowlist. If both ignored after a restart, the harness cannot express it — record the prompt-level caveat as the accepted state and close. If it works, ship via the review-gated PR path. Do not commit any restriction that has not passed the spawn probe.
<!-- SECTION:NOTES:END -->
