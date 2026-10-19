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

Open defects that ride upstream with their component (backlog review batch C, owner-approved 2026-10-18): TASK-554 (bare gh pr merge bypass + the unmeasured bashlex import-cost decision) with merge-review; TASK-1048 (bash -c / unquoted-heredoc bypass) with branch-commit. Before retiring either row, check the Seyag version fixes its defect or carries it as a known gap; close or re-scope the Tzurot task in the same commit.

## Merged from TASK-1206 (2026-10-18)

TASK-1206 (priority medium): pr-body-ref-gate rule 2 blocks a claim-shaped line with no cite or hedge, and the only way to see its verdict is to attempt gh pr create/edit; session mining 2026-10-11 counted 17 trips in 5 sessions, zero false positives, one session needing 8 attempts. Wanted: a read-only --check <file> mode over the same scanner (one scanner, two callers, no second vocabulary copy) that prints each flagged line with its rule, called from /tzurot-git-workflow § Create PR before gh pr create. Seyag takes this with the claim-shape row above. Acceptance addition: the preflight flags exactly the lines the hook would block (one probe runs both over the same fixture), and the git-workflow step names it once the Seyag version is wired.
<!-- SECTION:DESCRIPTION:END -->
