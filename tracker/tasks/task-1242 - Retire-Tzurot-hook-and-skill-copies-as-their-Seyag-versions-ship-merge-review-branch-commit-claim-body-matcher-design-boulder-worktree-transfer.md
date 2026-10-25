---
id: TASK-1242
title: >-
  Retire Tzurot hook and skill copies as their Seyag versions ship
  (merge-review, branch-commit, claim-body matcher, design-boulder,
  worktree-transfer)
status: To Do
assignee: []
created_date: '2026-10-18 12:57'
updated_date: '2026-10-19 04:39'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two more rows from TASK-1106 part 2 (2026-10-19 parity read), same retire-when-Seyag-ships rule: self-matching-pattern-guard (Seyag must add the leading-class literal-recurrence check plus mid-word bracket handling, the union; ask sent via Deck); python-heredoc-edit-guard (Seyag must also block write-only generation scripts, Tzurot python-heredoc-edit-guard.sh lines 64-66, or the Tzurot copy stays as a deliberate stricter local rule).

2026-10-25 ship check: merge-review SHIPPED (seyag 367ae14 + rounds, HEAD 59a2518; numberless arm verified by probe run — TASK-554 closed). claim-shape / pr-body-ref-gate SHIPPED (59a2518, `--check <file>` preflight included — TASK-1206's ask; that task was already archived in batch C). branch-commit NOT shipped (verified: no hook in the seyag inventory, no branch-commit commit). design-boulder / worktree-transfer unchecked this pass. Config surface offered by the seyag session for the claim-body row: SYG_PR_BODY_BASE_REF, SYG_PR_BODY_TASK_PATHS, SYG_PR_BODY_DOC_PATHS, SYG_PR_BODY_EXTRA_COMMANDS, SYG_PR_BODY_ACK_FILE, SYG_PR_BODY_RULE_REF, SYG_PR_BODY_CLAIM_SCAN=0.
<!-- SECTION:NOTES:END -->
