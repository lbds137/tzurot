---
id: TASK-496
title: 'Research: GitHub stacked PRs vs our rebase-only sequential-PR workflow'
status: To Do
assignee: []
created_date: '2026-08-09 19:38'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 496000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner flag 2026-08-09 - GitHub reportedly began rolling out stacked-PR support; unverified from memory (external-system claim - probe the shipped feature via GitHub docs/changelog first, not recall). Our doc-60-style chains (PR 1 -> 2 -> 3, each based on the last) are exactly the shape stacking targets.
Fix shape: read the actual shipped feature; assess fit against REBASE-ONLY merges, gh CLI support, the ci-gate monitor flow, and claude-review per-PR; note whether dependent-PR retargeting on merge removes our manual rebase step. Output: a short recommendation (adopt / ignore / partial) to the owner.
Acceptance: recommendation delivered with the probe evidence cited; adopt-path items filed separately if any.

RESEARCH DONE 2026-08-12 (changelog read: github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview). Feature: public preview since 2026-07-30; ordered PR layers each targeting the one below; parallel per-layer review; one-click merge of a layer plus everything below; upper layers auto-rebase/retarget on lower merges; CLI via gh extension install github/gh-stack; merge-queue support still rolling out. RECOMMENDATION DELIVERED to owner same day: NOT YET. (1) The changelog does not state which merge strategies stack-merge supports - REBASE-ONLY is our hard constraint, so this must be probed on a scratch repo before any real use. (2) Our merge machinery (pr-merge-review-check hook, SHA-pinned ci-gate monitors, the delete-branch worktree guard) intercepts per-PR gh pr merge; stack-merge via web/new CLI verbs would bypass the review gate, and auto-force-pushed upper layers stale every SHA-pinned monitor mid-stack. (3) The dominant drain workflow is independent single PRs - no stack shape. Remaining work when picked up: scratch-repo probe of stack-merge strategy + hook interception; adopt-path items filed separately if it passes.

Promote when: the next doc-60-shaped multi-PR feature chain is scheduled AND stacked PRs have reached GA.
<!-- SECTION:DESCRIPTION:END -->
