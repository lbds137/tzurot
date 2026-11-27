---
id: TASK-1572
title: Refresh vendored cloud-gate hook to deck-platform canonical body
status: To Do
assignee: []
created_date: '2026-11-27T15:52:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1562000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: deck-platform moved the canonical cloud-gate body (bin/cloud-gate on its origin/main; body sha256 prefix c24563808b610e7f, full 64-hex pinned as CLOUD_GATE_BODY_DIGEST in bin/cloud-launch; verified 11-27). The Tzurot vendored copy .claude/hooks/cloud-gate.sh lags: its body pin reads 0bf9e89f0ac48f0f, whole-file 8ab5c5fa4107aeeb (verified 11-27). Not a gate hole: enforcement is deck-side (cloud-launch unconditional gate 2 plus the prompt gate step, which verifies the fetched script against the digest pin); the vendored VM hook is best-effort context that fires only when the pool clone boots on a carrying tree (the boot-lottery finding).
What: re-copy the canonical body below the vendored header marker; update the body-sha256 pin line to the new 16-hex; run .claude/hooks/cloud-gate.probe.sh after the edit (guard:hook-probes covers it). Fold in the rollout-wording corrections, source deck-platform gate-fix-design.md sections 2 and 3 claims table: the vendored VM hook is best-effort context, never a control; landing the hook on main does not fix the VM gate; the test-only 98% exemption (--class test-only, new in the body) lives at the launcher and gate, never the VM hook. Number-collision note: TASK-383 in this tracker is the serial-vision task; always write deck-platform TASK-383.
Acceptance: vendored body digest matches the CLOUD_GATE_BODY_DIGEST prefix; probe green; the header states the best-effort role; PR coordinates with the Deck Platform B process-work vehicle (rollout-wording corrections + seven-lows carry) if that opens first.
<!-- SECTION:DESCRIPTION:END -->
