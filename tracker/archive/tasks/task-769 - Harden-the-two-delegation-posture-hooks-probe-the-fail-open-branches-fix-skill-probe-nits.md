---
id: TASK-769
title: >-
  Harden the two delegation-posture hooks: probe the fail-open branches, fix
  skill/probe nits
status: To Do
assignee: []
created_date: '2026-08-24 21:53'
updated_date: '2026-09-04 19:59'
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
Two more shapes from the 2026-08-26 mining run (first full live window for both hooks): (5) dispatch-posture-gate re-triggered 4x in one session on comment-only inline-exempt edits — the exemption is discoverable only by tripping the gate, so every comment-only edit costs a blocked-then-retry cycle; name the exemption in the block banner or honor a same-session ack so the second trip is free. (6) python-heredoc-edit-guard fired inside at least 2 worktree worker dispatches (workers defaulted to heredoc rewrites before self-correcting) — the hook held as backstop each time; the companion fix is a landmine line in the /tzurot-orchestration spec template (shipping separately) so worker specs carry the Edit-tool instruction up front.

FREQUENCY BUMP (PR #2266, 2026-08-31): dispatch-posture-gate now re-arms per COMMIT, not per day (HEAD joined the ack key — the per-day ack had let one build's ack silently cover every inline review round). That fix is correct and stays, but it multiplies how often shape (5) can fire: a PR with several review-round commits now offers one comment-only trip per commit instead of one per day. Raises this task's practical priority; the shape-(5) fix (name the exemption in the banner, or a same-session comment-only ack) is the mitigation.

Acceptance: both probes cover their fail-open branches (or comments hedged); skill step 3 runnable as written; the false-positive shape either narrowed or documented in the hook header; the comment-only exemption path costs at most one gate trip per session.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:59
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-769 finds it.
---
<!-- COMMENTS:END -->
