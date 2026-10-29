---
id: TASK-1323
title: Fresh-session probe of the SYG_GH_WRAPPERS wiring - gates PR 2684 merge
status: To Do
assignee: []
created_date: '2026-10-29T02:38:00Z'
labels:
  - area:repo
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1306000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2684 wires SYG_GH_WRAPPERS=pnpm ops into .claude/settings.json (plus a shape guard). The walker reads the SESSION env (seyag hooks/lib/outbound.py:410), so no in-session probe can validate it: this session predates the change and the headless fresh-session vehicle was classifier-denied. The wiring is UNVERIFIED in the runtime that will carry it until this probe records. Recipe (next session opened in the tzurot checkout on branch chore/syg-gh-wrappers, which carries the branch settings; amended per the 2684 round-4 review, finding 2): the blocked-direction probe targets a THROWAWAY DRAFT PR (chore/probe-throwaway, PR 2685 - created off develop), never 2684 itself - a fail-open outcome must not publish private-term text into a public PR history. The private-term body uses a FABRICATED id in the session-link URL shape - the probe session constructs it locally from the pattern (session_ plus a fake PROBE000000000000-style suffix); never a real session id, and the literal URL never goes into committed text (the repo's session-url gate blocks the shape itself, as this task's own filing history shows). Matcher pre-check (2684 round-5 review, finding 1): before the wiring probe, confirm the matcher fires on the fabricated shape at all - run a PLAIN gh call (plain-gh coverage predates this wiring, so a block there isolates shape-matching from wrapper coverage): gh pr edit 2685 --body-file <private-term-body> - expect BLOCK. If plain gh does not block the fabricated shape, swap the fabricated id for one that does (still fabricated), and only then run the wiring probe. Run pnpm ops gh:pr-edit 2685 --body-file <private-term-body> - expect the hook to BLOCK; then run it with a clean body-file - expect pass. Record all verbatim in the PR body Probe section. Acceptance: blocked-direction shows a hook denial and clean-direction exits 0, both quoted in the PR body - then merge under the standing develop-targeted authorization. If the blocked direction does NOT block: do not merge; capture the denial-vs-env diagnosis (hook stderr, env echo of SYG_GH_WRAPPERS in the fresh session) and escalate to Lila. Optional third observation (documents a known limitation, NOT an acceptance criterion): the flag-bearing form pnpm -C <root> ops gh:pr-edit 2685 --body-file <private-term-body> is EXPECTED not to block - the positional match cannot skip pnpm flags (outbound.py:414 compares argv[1:n] verbatim) - record if it ever does. Covered form is pnpm ops gh:<verb> with cwd set by the shell.
<!-- SECTION:DESCRIPTION:END -->
