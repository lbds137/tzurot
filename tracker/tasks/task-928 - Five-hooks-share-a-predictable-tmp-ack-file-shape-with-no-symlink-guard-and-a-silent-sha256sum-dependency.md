---
id: TASK-928
title: >-
  Five hooks share a predictable /tmp ack-file shape with no symlink guard and a
  silent sha256sum dependency
status: To Do
assignee: []
created_date: '2026-09-09 22:15'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 926000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the block-once ack files in .claude/hooks all resolve to a fixed, per-UID-guessable path and append to it with no O_NOFOLLOW and no pre-existence check — `/tmp/.claude_*.$(id -u)`. The sticky bit on /tmp stops another local user deleting or renaming that name, but not creating it first as a symlink, so on a shared multi-user host the append and the following chmod 600 can land on an attacker-chosen target. Surfaced by the #2383 review when the pattern reached a fifth hook.

Second defect in the same shape: each site guards the whole block behind `command -v sha256sum`, so where that binary is absent the feature silently does not run at all — no warning, no stderr note. Stock macOS ships `shasum -a 256` rather than GNU coreutils, so the hook would no-op there while reading as healthy. That is the certifies-broken-code-green shape the carry-forwards section of CURRENT.md already names.

Sites (grep -ln ack .claude/hooks/*.sh): pr-body-ref-gate.sh, pr-merge-review-check.sh, pr-monitor-reminder.sh, dispatch-posture-gate.sh, develop-code-commit-guard.sh. The fifth was added by PR #2383, which fixed the sha256sum half for its own site only; the other four still carry both halves.

Why filed rather than fixed in the PR that surfaced it: the fix is one shared helper across five files, which is a batch and not colocated with any one of them. Filed as the batch per the granularity ladder rather than as a row against whichever hook is touched next.

Fix shape: one sourced helper in .claude/hooks/ owning ack-key derivation and the append. Prefer a per-repo state directory under .git/ over shared /tmp — it is single-user by construction and removes the symlink question rather than guarding it. Digest falls back from sha256sum to shasum -a 256 and, when neither exists, writes one stderr line and fails OPEN, matching current behaviour but audibly. Each hook keeps its own ack key namespace.

Acceptance: all five hooks derive their ack path and digest through the one helper; no ack path lives under a world-writable directory, or the write refuses a symlinked target; with both digest binaries masked from PATH each hook prints one stderr line and still fails open; every affected hook probe passes and guard:hook-probes stays green.
<!-- SECTION:DESCRIPTION:END -->
