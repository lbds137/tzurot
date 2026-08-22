---
id: TASK-732
title: >-
  Orchestration retrospective at the beta.206 cut - mine dispatch/report pairs +
  subagent transcripts
status: To Do
assignee: []
created_date: '2026-08-22 16:25'
labels:
  - 'area:skills'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 732000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the nested-dispatch pattern has moved the main defect source upstream into the dispatch SPECS (three spec-level catches in three consecutive units: PR 2.4 doc-vs-spec, TASK-728 impossible threading route, TASK-726 name-keyed tag map). Tightening the spec template needs the evidence reviewed together, and the standard mining lane cannot see it: /tzurot-session-mining Step 1 extracts USER turns only, while this signal lives in dispatch prompts + orchestrator reports (main session JSONL, assistant/tool turns) and the subagent transcripts (persist durably at ~/.claude/projects/<slug>/<session-id>/subagents/agent-<id>.jsonl - verified 2026-08-22, 88 files/35MB this session; the /tmp tasks/*.output paths are symlinks into that store).
What: at the beta.206 cut, run a dedicated extraction over the epoch sessions: (a) every Agent-tool dispatch prompt + its task-notification report from the main JSONLs, (b) the matching subagents/*.jsonl internals for units where the report narrates a spec catch or deviation. Taxonomy: spec-defect-caught / worker deviation / gate friction / plumbing noise (e.g. the 2026-08-22 inner-worker report misroute). Output: per-unit table (rounds, blocking findings, spec catches, token spend) + proposed spec-template edits to /tzurot-orchestration. Same privacy boundary as mining: corpus stays in mined-corpus/, only operationalized outcomes enter the repo.
Acceptance: retrospective delivered to the owner with the per-unit table and concrete template-edit proposals; accepted edits land in the orchestration skill via review-gated PR.
<!-- SECTION:DESCRIPTION:END -->
