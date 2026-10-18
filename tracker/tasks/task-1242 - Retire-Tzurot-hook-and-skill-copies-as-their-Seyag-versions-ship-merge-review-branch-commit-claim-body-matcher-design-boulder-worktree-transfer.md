---
id: TASK-1242
title: >-
  Retire Tzurot hook and skill copies as their Seyag versions ship
  (merge-review, branch-commit, claim-body matcher, design-boulder,
  worktree-transfer)
status: To Do
assignee: []
created_date: '2026-10-18 12:57'
labels:
  - 'area:hooks'
  - 'state:dependent'
  - 'size:M'
dependencies: []
priority: low
ordinal: 1230000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Seyag plugin agreed on 2026-10-18 (owner-approved brief) to take generalized versions of five Tzurot surfaces, configured through SYG_* env vars in .claude/settings.json. Once each ships, the Tzurot copy is a twin and should go, the same way TASK-1106 retires the earlier twins.

What, one row per Seyag component; retire each only after Seyag reports it shipped:
- merge-review (from .claude/hooks/pr-merge-review-check.sh + probe; set SYG_REVIEW_BOT_LOGIN). Seyag also takes TASK-928's symlink-safe ack file.
- claim-shape family gh pr create/edit --body matcher (from .claude/hooks/pr-body-ref-gate.sh + probe and lib/claim-shapes.sh). Seyag also takes TASK-1206's --check preflight.
- branch-commit, protected-branch rule (from develop-code-commit-guard.sh, WITHOUT its commit-header pre-check, which stays here; set SYG_PROTECTED_BRANCHES, SYG_DOC_PATHS_RE) and board rule (from board-commit-branch-gate.sh; set SYG_BOARD_PATHS_RE and the target branch). The Tzurot guard then shrinks to the header pre-check only.
- design-boulder skill (from .claude/skills/tzurot-design-boulder; keep a thin Tzurot wrapper for paths if needed).
- worktree-transfer bin (from packages/tooling/src/dev/worktree-transfer.ts; set SYG_WORKTREE_BRANCH_RE). The PR-monitoring prose merges into Seyag's pr-monitor-reminder docs; trim the Tzurot copies to the Tzurot bindings.
Per row: wire the Seyag component in settings, delete the Tzurot copy and its probe, drop it from the hook-probes registry, update the rules and skills that name it, run guard:hook-probes.

Acceptance: each row retired or explicitly kept with a reason; no hook runs twice for one tool call.
<!-- SECTION:DESCRIPTION:END -->
