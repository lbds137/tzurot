---
id: TASK-1135
title: no-raw-log-content does not inspect logger.child bindings
status: To Do
assignee: []
created_date: '2026-09-27 20:13'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: @tzurot/no-raw-log-content matches the fields object of log-method calls (info/warn/error/debug and the Error sinks); a logger.child({...}) binding is not a sink it walks, so a filename, truncation or response body bound into a child logger would ride every line that logger emits without a finding. Latent today: git grep for .child( in non-test services/packages code finds one site, services/ai-worker/src/services/AttachmentProcessor.ts (logger.child({ requestId })), which binds only an id. Surfaced by the TASK-1121 orchestrator.

What: add child() as a log sink in the rule (same SinkPolicy as a log call), with a flagged case and a clean-id case in no-raw-log-content.test.ts.

Acceptance: logger.child({ name: attachment.name }) is a rawFilename finding; logger.child({ requestId }) stays clean.
<!-- SECTION:DESCRIPTION:END -->
