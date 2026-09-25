---
id: TASK-1109
title: >-
  Cloud units start in accept-edits, not auto: pass --permission-mode auto on
  the cloud launcher and verify
status: To Do
assignee: []
created_date: '2026-09-25 19:21'
labels:
  - 'area:repo'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the TASK-1081 cloud unit (2026-09-25) stalled 30+ min on a sensitive-file permission prompt (.husky/pre-push edit) because the session ran in accept-edits mode. Cause by the docs (permission-modes page, relayed by the claude-code-guide agent, not runtime-confirmed): mode = flag, then permissions.defaultMode from settings, then the built-in default; the owner defaultMode auto lives in user-scope ~/.claude/settings.json which the cloud VM never sees, the repo .claude/settings.json sets no defaultMode, and the cloud built-in default is accept-edits. The owner switched the session to auto by hand.

Fix shape: (1) the next fresh cloud launcher (docs/local/dispatch/launch-*.sh) runs exec claude --cloud --permission-mode auto "$(cat spec)"; verify via RemoteTrigger get_run_log that no permission prompt event appears on a sensitive edit, or that the session UI shows Auto. (2) If the flag is ignored by --cloud (undocumented), add permissions.defaultMode auto to the repo .claude/settings.json by PR (the docs confirm cloud sessions honour that key for accept-edits). Then write the verified form into /tzurot-orchestration section Cloud dispatch (the launcher block) and doc-108, by PR (skill edits are review-gated).

Acceptance: a fresh cloud unit that edits a .husky or .claude file completes without a permission prompt; the skill launcher block carries the verified flag or the settings key.
<!-- SECTION:DESCRIPTION:END -->

created: 2026-09-25 15:51
---
SECOND SHAPE, same root (2026-09-25, PR #2540 round 1): with the session switched to auto by the owner, the cloud unit applied the round fixes but its classifier blocked git rebase --autosquash + push --force-with-lease as [Git Destructive]; it pushed the fixup as a plain commit (fixup-check red) and the driver autosquashed and force-pushed locally. So a cloud unit cannot finish any review round that rewrites history, whatever mode it starts in. Fix shape addition: the cloud-dispatch section of /tzurot-orchestration and doc-108 state the round contract as cloud pushes the fixup commit, driver autosquashes and force-pushes after its own diff read (or the owner allows the rewrite in the session UI once).
---
