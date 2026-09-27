---
id: TASK-1119
title: >-
  Retire Tzurot's gh:ci-gate monitor hook copies once the harness pr-ci-wait
  port ships
status: To Do
assignee: []
created_date: '2026-09-27 10:03'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Harness session is porting Tzurot's `gh:ci-gate` wait and `.claude/hooks/pr-monitor-reminder.sh` into the harness plugin (pr-ci-wait plus a PostToolUse pr-monitor-reminder). The plugin copy yields to Tzurot's hook until Tzurot deletes it, so two copies exist until Tzurot retires its own.

What: when the Harness session reports the merged version, follow the retirement steps in the harness repo's `docs/adoption-tzurot.md` from that PR. That includes the `guard:monitor-command` three-copy pin (05-tooling.md, the hook heredoc, /tzurot-git-workflow) and the hook-probe registry entry. Via PR (hooks and rules are review-gated).

Acceptance: one pr-monitor reminder fires per PR push, not two; `pnpm ops guard:monitor-command` and `guard:hook-probes` pass; the three prose copies point at the harness mechanism.
<!-- SECTION:DESCRIPTION:END -->
