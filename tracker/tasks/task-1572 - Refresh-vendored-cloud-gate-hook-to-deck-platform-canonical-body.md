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
Why: deck-platform moved the canonical cloud-gate body while the Tzurot vendored copy lags: bin/cloud-gate on its origin/main now carries body sha256 prefix 78ef44b1974c194e (full 64-hex pinned as CLOUD_GATE_BODY_DIGEST in bin/cloud-launch; 16-hex prefix verified by hash at adoption commit f5382ec1, 11-27; superseding c24563808b610e7f, which the vendored sync never caught). The Tzurot vendored copy .claude/hooks/cloud-gate.sh lags: its body pin reads 0bf9e89f0ac48f0f, whole-file 8ab5c5fa4107aeeb (verified 11-27). Not a gate hole: enforcement is deck-side (cloud-launch unconditional gate 2 plus the prompt gate step, which verifies the fetched script against the digest pin); the vendored VM hook is best-effort context that fires only when the pool clone boots on a carrying tree (the boot-lottery finding).
What: re-copy the canonical body below the vendored header marker; update the body-sha256 pin line to the new 16-hex; run .claude/hooks/cloud-gate.probe.sh after the edit (guard:hook-probes covers it). The f5382ec refresh is NOT byte-cosmetic: the test-only stop chain now judges CLOUD_GATE_WEEK_STOP > 98 (the ruling's hard stop); the reading's stop_pct validates but judges nothing in test-only; the old chain judged the posture soft stop (an 11-24-burn fossil, found by Deck Platform B's gate-order probe launches) — the vendored copy inherits this behavior on sync. Fold in the rollout-wording corrections, source deck-platform gate-fix-design.md sections 2 and 3 claims table: the vendored VM hook is best-effort context, never a control; landing the hook on main does not fix the VM gate; the test-only 98% exemption (--class test-only, new in the body) lives at the launcher and gate, never the VM hook. Number-collision note: TASK-383 in this tracker is the serial-vision task; always write deck-platform TASK-383. Copy convention (Deck Platform B 11-27, verified): the body is everything after the `# body-sha256:` marker line; source anchor is bin/cloud-gate at deck-platform origin/main, adoption commit f5382ec1 (prior anchor c72674f — unchanged through c1894640 — superseded 11-27 before any vendored sync). If the copied body digest disagrees with the pin at verification, re-copy from origin/main; a mismatch is never negotiated.
Acceptance: vendored body digest matches the CLOUD_GATE_BODY_DIGEST prefix; probe green; the header states the best-effort role; PR coordinates with the Deck Platform B process-work vehicle (rollout-wording corrections + seven-lows carry) if that opens first.
<!-- SECTION:DESCRIPTION:END -->
