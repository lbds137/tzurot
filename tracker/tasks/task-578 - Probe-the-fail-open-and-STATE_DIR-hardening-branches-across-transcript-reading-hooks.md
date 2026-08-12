---
id: TASK-578
title: >-
  Probe the fail-open and STATE_DIR-hardening branches across transcript-reading
  hooks
status: To Do
assignee: []
created_date: '2026-08-12 23:18'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 578000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: both context-size-reminder.probe.sh and queued-message-receipt.probe.sh pin their happy-path logic exhaustively while the security-load-bearing fail-open branches are documented but unverified: the no-jq path (command -v jq failure) and the STATE_DIR symlink-plant / foreign-ownership rejections ([ ! -L ] / [ -O ]). Merits, not origin: these branches are exactly the CWE-377 defense the comments call load-bearing, so they deserve pins; deferred as a batch because the harness needs PATH shims (no-jq) and ownership/symlink simulation - a distinct unit, not a ride-along fixup.

Fix shape: shared probe helpers (PATH-shimmed jq absence; a symlinked STATE_DIR fixture; ownership case may need a documented skip when single-uid) applied to BOTH probes in one parity pass.

Acceptance: each fail-open branch has a case that reddens when its guard is removed. Source: #2081 round-2 review item 2.
<!-- SECTION:DESCRIPTION:END -->
