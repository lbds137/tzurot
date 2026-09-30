---
id: TASK-1148
title: >-
  Health uptime field: worker /health has no uptime; verify source of the 76h
  reading Deck management saw
status: To Do
assignee: []
created_date: '2026-09-30 22:38'
labels:
  - 'area:observability'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: during the 2026-09-30 boot-restore verification, Deck management read an uptime of ~274704s (~76h) from a health endpoint on freshly restarted processes, suggesting the field measures something other than process uptime and could mislead triage. Live verification by the Tzurot driver 2026-09-30 ~18:45 EDT: api-gateway /health uptime reads 474527ms on a ~8-minute-old process - CORRECT (routes/public/health.ts computes Date.now() - startTime). ai-worker /health returns NO uptime field at all (null when read). The 76h figure is unexplained by either Tzurot endpoint; likeliest source is a system-uptime (os.uptime) style field on whatever surface was probed via the tailnet - possibly the Spacebar instance B health reached through Caddy, not Tzurot.

What: (1) confirm with Deck management which exact URL/field produced 274704s; (2) if it was a Tzurot surface, fix the uptime source; (3) decide whether ai-worker /health should carry an uptime field for parity with the gateway (types.ts declares uptime for the gateway contract).

Acceptance: the endpoint Deck management actually probed reports true process uptime; worker /health either gains uptime or the contract documents its absence.

RESOLUTION 2026-09-30 ~22:50 UTC (Deck management): thread (1) CLOSED as reporter error - the reading was `curl http://localhost:3000/health` direct on the Deck at 22:34:31Z, field "uptime":274704 MILLISECONDS = 4.6 minutes on the freshly restored process, read as seconds and mis-scaled to 76h. The gateway computation (Date.now() - startTime) was correct and always was. REMAINING WORK: thread (3) only - decide whether ai-worker /health gains an uptime field for parity with the gateway contract, or the contract documents its absence.
<!-- SECTION:DESCRIPTION:END -->
