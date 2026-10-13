---
id: TASK-878
title: Narrow the lossy-pipe-guard heredoc rejoin to statement continuations only
status: To Do
assignee: []
created_date: '2026-09-03 12:18'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 876000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the rejoin substitution in .claude/hooks/lossy-pipe-guard.sh collapses a heredoc opener line onto whatever text follows it, with no check on what that text is. It exists so a target and its truncator stay in one scan segment after strip_heredoc_bodies removes the body - correct for the substitution form, where the remainder after the emptied heredoc begins with a closing paren and genuinely continues the same statement. For a BARE heredoc redirect the next line is a NEW statement, and gluing them creates a false block.

Measured both directions with the probe JSON payload shape, 2026-09-03. Input: git commit -F - with a heredoc body, then on the following line a find piped into tail. Against the branch carrying the heredoc-strip change: exit 2, blocked. Against the pre-change hook on develop, extracted to a temp path with a symlink to the shared lib: exit 0, allowed. So it is a surface that change introduced, not a pre-existing one. Surfaced by claude-review round 3 on PR 2316, which also noted the shape is plausible in agent use - commit, then check something with a filtered pipe.

Documented and pinned in that PR rather than fixed: the comment now states the true boundary, a probe fixture asserts the blocking behaviour, and it fails toward over-blocking, which that file accepts elsewhere. Cost is one re-run.

Fix shape: require the text following the emptied heredoc to CONTINUE the statement before rejoining - in practice a closing paren, which is what the substitution form leaves behind. A bare heredoc terminator followed by a new statement would then stay on its own line and split into its own segment, as it did before. Before implementing, sweep what else can legitimately follow a terminator inside one statement - a redirect, a chained operator on the same logical line - because the narrowing must not reintroduce the segment split the rejoin exists to prevent. The existing fixture named UNQUOTED indented heredoc plus trailing tail is the canary that catches that regression.

WHY THIS IS NOT A ONE-LINER, established during PR 2316 round 3 rather than left for whoever picks this up. Three things:

1. The blast radius is NOT uniform across the three heredoc-plus-trailing-filter fixtures, and this is the half that is easy to get wrong. The UNQUOTED indented one leaves a remainder beginning with a closing paren, so it survives a paren-restricted rejoin. Its two quoted siblings - named heredoc message plus real trailing tail, and INDENTED heredoc plus real trailing tail - are documented in the probe as surviving via the DOUBLE-QUOTE STRIP, not via the rejoin at all. So which fixtures the rejoin is actually load-bearing for has to be measured per fixture, by mutating the rejoin and reading which ones move, not reasoned about from their shape.

2. The remainder is not always literally a closing paren. strip_heredoc_bodies leaves the terminator line and the newline, and whitespace, a closing quote, or a further redirect can sit before the paren. The character class has to be established empirically, and getting it wrong fails toward UNDER-blocking, which is the direction this hook exists to prevent.

3. The rejoin is composed from the shared HEREDOC_OPENER pattern, and the file records that re-typing that pattern already caused one regression - a dropped here-string lookbehind that false-blocked. Any change to the rejoin trailing match is a change inside that same coupling.

Method note for whoever implements this: two guards in this repo interfere with INVESTIGATING this hook. Writing a repro inline in a Bash command trips lossy-pipe-guard itself, and a printf containing a git target trips the cwd-drift-guard complexity check. The working method is to write the fixture text to a scratch file, then feed it through jq into the probe payload shape and pipe that into the hook. A before-and-after comparison also needs the pre-change hook AND its lib extracted together, plus a positive control - a plain piped commit that must still block - because otherwise an allow verdict is indistinguishable from a fail-open import error.

Acceptance: the single-heredoc-plus-unrelated-filter fixture flips from blocking to passing, and its comment moves from naming an accepted over-block to naming the fix; every existing probe fixture stays green, in particular the bypass canary; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
