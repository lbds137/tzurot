---
id: TASK-306
title: Three acknowledged fail-open gaps in cwd-drift + promise-ledger hooks
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-09-04 19:59'
labels:
  - 'origin:review'
  - 'area:process'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 306000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1732 review, three in-spec fail-safe gaps in `cwd-drift-guard.sh` + `promise-ledger-check.sh`) — all acknowledged trade-offs of the fail-open design, none a false-block: (a) the quote-strip that prevents false-blocking commit messages ALSO blinds the guard to a genuinely-quoted drifted pathspec (`git add "packages/x/y.ts"` from a subdir → stripped → allowed); (b) the `git -C` short-circuit substring-matches anywhere, so `git -C /other status && git add packages/x` from a drift waves the whole compound command through; (c) `promise-ledger-check.sh` re-reads+re-parses the full transcript JSONL every Stop event — O(transcript) per turn-end, grows with long/compacted sessions. **Fix shapes**: (a) scan the git subcommand's arg tokens instead of quote-stripping wholesale, or accept+comment; (b) evaluate `-C` per pipeline segment; (c) walk backward for the last user-turn boundary + last text block instead of a full forward pass. **Promote when**: a real drift mistake slips one of a/b, or turn-end latency from (c) becomes noticeable.

**Why:** All fail-OPEN (miss a block), never false-block — in-spec for a narrow guard; refine only if a real miss or latency shows up.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:59
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-90 (Idea Hook and skill hardening residue — fail open branches and unprobed arms); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-306 finds it.
---
<!-- COMMENTS:END -->
