---
id: TASK-769
title: >-
  Harden the two delegation-posture hooks: probe the fail-open branches, fix
  skill/probe nits
status: To Do
assignee: []
created_date: '2026-08-24 21:53'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 769000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2214 round-4 review left three non-blocking gaps, dispositioned here per the merge-on-green posture, plus one live-observed false positive.
Fix shape: (1) probe cases pinning the two documented fail-open branches — unwritable ack file for dispatch-posture-gate (point DISPATCH_POSTURE_ACK_FILE at a read-only dir, expect exit 0) and a PCRE-erroring grep for python-heredoc-edit-guard (PATH-shim a grep that exits 2, expect exit 0) — or hedge the header comments per 02-code-standards claim rule; (2) define MAIN_SESSION_FILE in tzurot-usage-audit SKILL.md step 3 (currently referenced undefined); (3) gate probe case 7 uses literal backslash-n in a double-quoted string, not a real multiline heredoc — convert to a heredoc fixture; (4) known false positive observed live: a non-interpreter command (gh pr-edit) whose heredoc BODY quotes both trigger shapes in prose blocked and needed the override — consider requiring the interpreter match outside quoted/backticked context, or accept and document.
Acceptance: both probes cover their fail-open branches (or comments hedged); skill step 3 runnable as written; the false-positive shape either narrowed or documented in the hook header.
<!-- SECTION:DESCRIPTION:END -->
