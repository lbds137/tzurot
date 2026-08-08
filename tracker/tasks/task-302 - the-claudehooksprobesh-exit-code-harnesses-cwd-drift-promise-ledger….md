---
id: TASK-302
title: Probe-harness parity for the remaining .claude hooks
status: To Do
assignee: []
created_date: '2026-07-20 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'origin:review'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 302000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-20 (#1732 review observation) — the `.claude/hooks/*.probe.sh` exit-code harnesses (cwd-drift, promise-ledger, develop-code-commit-guard) are "run manually after editing the hook," not wired into `pnpm quality`/CI — a future hook edit could silently regress the guard with no safety net. Applies to the pre-existing develop-code-commit-guard.probe.sh too (not new to #1732). **Fix shape**: a lightweight gate that runs every `*.probe.sh` when any `.claude/hooks/*.sh` changed (a `guard:hook-probes` ops command in the lint job, or a pre-commit keyed on the hooks-dir diff). **Promote when**: next hook-script touch, or a probe-detectable regression slips through.

**Why:** 05-tooling prefers structural enforcement over remembered manual steps; the probes exist but their execution is memory-dependent.

## MEMBER 1 SHIPPED — #2003 (2026-08-08)

`pnpm ops guard:hook-probes` runs every registered probe in `pnpm quality` and the
CI lint job, plus a bidirectional `HOOK_PROBES` registry (`check-hook-probes-registry.ts`)
covering `.claude/hooks/` AND `.husky/`: every hook needs a probe or a written
reason, and orphan/duplicate/empty-path rows all hard-fail.

Two decisions that departed from the fix shape above, both with data:

- **Unconditional, not diff-keyed.** Measured ~11s across the six probes — noise
  beside knip/cpd/depcruise in the same job. An unconditional gate also cannot
  drift out of sync with its own trigger condition, which a diff-keyed one can.
- **Discovery is fail-closed on both families.** `.claude/hooks/` matches script
  extensions OR extensionless-plus-exec-bit; `.husky/` matches git's exact
  client-side hook names. Either alone left a shape invisible to the check.

The gate's FIRST CI run paid for itself: `develop-code-commit-guard.probe.sh` had
grown a dependency on local `develop`/`main` branches, which a shallow
`actions/checkout` does not have. Invisible for as long as the probe only ever ran
on one machine.

**New local precondition worth knowing before the remaining members:** `pnpm quality`
now requires local `develop` and `main` (`git fetch origin develop:develop`).
Branches are fabricated only on a real Actions runner — gated on `GITHUB_ACTIONS`
set AND `ACT` unset, because nektos/act sets `CI`, `GITHUB_ACTIONS` and `ACT`
alike (read from its assignment sites in `pkg/runner/run_context.go`; act is not
installed here, so this is a producer-read, not a live capture).

**Design pre-validated for the pr-merge-review-check member:** a `gh` shim first on
PATH plus a `TZUROT_PR_MERGE_ACK_FILE` env override drives every branch of that hook
with no network. Pin the shim's `pr view` to return `main` and the release banner's
`for PR #N` line makes the extracted PR number assertable — which is the assertion
that matters, since a wrong PR with no review exits 0 and merges UNREVIEWED.

**DESIGN CORRECTED 2026-08-08 — NO env override is needed, and none should be
added.** The ack path is `/tmp/.claude_pr_merge_ack.$(id -u)`, and `id` is a PATH
lookup. A probe that already shims `gh` onto PATH can shim `id -u` in the same
directory and the ack file redirects with ZERO production change to the
highest-stakes hook in the set. That is strictly better than both options this
note previously weighed: no new bypass surface on the merge gate, and unlike a
sed-copy the probe drives the REAL script rather than a mutated one.

Measured end-to-end against the real hook before writing any harness — every
branch is reachable offline this way:

- release PR (base=main) WITH a review -> exit 2, release block present, ack
  holds both `2000:777` and `RELEASE:2000`, retry exits 0
- release PR with NO review -> still exit 2 with the reminder (the defect #2002's
  review caught; confirmed not regressed)
- feature PR (base=develop) with no review -> exit 0, silent
- origin-language body -> `ORIGIN-LANGUAGE DETECTED` fires
- a fresh review comment-id -> re-arms the gate: 2 -> 0 -> 2
- the real ack file was byte-identical before and after (md5 checked)

The registry's `unprobedReason` for this hook still asserts the env override is
needed; correct it in the same PR.

MEMBER SHIPPED — #2005 (2026-08-08): `pr-monitor-reminder.probe.sh`, 40+
assertions over early exits, both boundaries of both command-match alternatives,
all three candidates of the PR-URL fallback chain, the dedup ledger on BOTH the
PR and SHA axes (a throwaway `git init` repo supplies a HEAD that can move), the
assignee backfill including bot/hygiene skips and both fail-open paths, and the
banner's required lines. The hook took one change — `SEEN_FILE` now honors
`TZUROT_PR_MONITOR_SEEN_FILE`, because pinned to the real path the probe writes
the live key on run 1 and early-exits at dedup on every run after, going quietly
inert while still exiting 0. Nothing is gated on that ledger except whether a
banner prints, so it weakens no check.

CARRIED INTO THE LAST MEMBER, all three from #2005's review rounds:

1. **Document the shim's boundary.** The `gh` shim dispatches on `"$1 $2"` and
   ignores the real `--json`/`--jq` flags, so the probe pins parsing but NOT the
   `--jq` output-shape contract: change `--jq` to emit a different shape and the
   shim keeps returning the old fixture while the hook is broken against real
   `gh`. Low risk, but `husky-pre-commit.probe.sh` carries an explicit "what this
   does not pin" section and `pr-monitor-reminder.probe.sh` does not. Add one to
   both when writing the third shim.
2. **Enumerate DIMENSIONS before writing mutants.** Four of five review rounds on
   #2005 found the same class: an untested axis rather than a forgotten case —
   the SHA half of a two-part key, one side of a two-sided boundary, one branch
   of a three-candidate chain, one alternative of a two-alternative regex. The
   mutation testing was real and caught real defects; the mutants just clustered
   on whichever axis was top-of-mind. Before calling coverage complete, list the
   axes of every composite key, boundary, and fallback chain and vary each.
3. **A mutant needs its own verification.** Twice a BROKEN mutant produced a
   false "All probes passed" against an effectively unmodified file — once from a
   structural over-deletion, once from a `sed` that silently failed on a
   bracket-heavy regex. Assert the mutant diff is non-empty before trusting its
   result.
4. **Soften the review-round cap wording in `/tzurot-review-response`.** The
   skill reads as a hard "cap at 3 automated rounds"; the owner clarified
   2026-08-08 that it is a rule of thumb, not a hard stop. Round 4 on #2005 was
   applied over the cap on agent judgement (the finding made a comment in the
   diff false) and the owner confirmed that was the right call. One-line wording
   change; skills are review-gated so it needs a PR, and this is the next one.

MEMBER (added 2026-08-07 while shipping TASK-458): `.claude/hooks/pr-merge-review-check.sh` has no probe either, and it is the highest-stakes hook in the set — it BLOCKS `gh pr merge` and is the structural backstop behind 00-critical's read-the-review rule. #2002 modified it (folding in the release-finalize reminder) and the only way to verify the change was a hand-built harness: copy the script to /tmp with ACK_FILE redirected, run it against a real merged main-based PR and a develop-based one, and assert exit 2 -> exit 0 on retry plus release-section presence/absence. That worked (all four assertions passed) but nothing re-runs it, which is this task's whole complaint. The ACK_FILE redirect is the only parameterization needed — worth making the script honor an env override so the probe does not have to sed itself a copy.

MEMBER (added from the #1985 round-6 review): `.husky/pre-commit` has no probe.sh at all — its TEMPORAL_PATTERN catch/ignore smoke list lives as an embedded shell COMMENT that a human is expected to copy-paste and run. #1985 tightened that pattern (`round [0-9]+` to `round[- ][0-9]+`), extended the smoke list to 11 catch / 9 ignore cases, and verified them by hand, but nothing re-runs them. So this hook needs the probe.sh written first, then wired by the same gate as the rest. Extracting the pattern from the file and asserting the two lists against `grep -E` is the whole harness — the existing probe.sh files are the shape to copy.

MEMBER (added 2026-08-07 from the #2002 round-7 review): when the
pr-merge-review-check probe is written, pin PR-NUMBER EXTRACTION as its own case
group. The extraction is `REMAINDER="${COMMAND#*gh*pr*merge}"` followed by the
first standalone all-digit token. That uses SHORTEST-prefix removal, so a chained
command carrying an earlier `gh`...`pr`...`merge` token sequence (an echoed
string, a heredoc mentioning the command) can anchor the remainder on the wrong
occurrence.

Merits disposition, since the reviewer scoped it as pre-existing and that is not
a verdict: NOT fixed in #2002, and not because it predates the PR. It is
genuinely low-risk - misleading it needs an earlier gh/pr/merge sequence
FOLLOWED by a bare digit token before the real invocation - but the failure mode
is not benign if it ever fires: a wrong PR number makes the gate fetch a
different PR's review, and if that PR has none, the gate exits 0 and the merge
proceeds UNREVIEWED. That is the exact outcome this hook exists to prevent, so
it earns a pinned case rather than a shrug.

Cases to pin: bare `gh pr merge 2002`; flags-first `gh pr merge --rebase 2002`;
a chained `echo "gh pr merge 1" && gh pr merge 2002`; and a heredoc body
mentioning the command. Assert the extracted PR_NUM, not just the exit code -
exit code alone cannot distinguish "right PR" from "wrong PR with no review".

TRIGGER SET CORRECTED (measured while shipping #2003, against a copy of the
hook with ACK_FILE redirected and a PATH-shimmed gh; PR_NUM read back from the
release banner's "for PR #N"). The mechanism is real but one listed trigger
does NOT hold, and repeating it in a PR body would have sent someone to verify
a path that was never broken:

- `echo "gh pr merge 1" && gh pr merge 2002` -> extracts 2002 (CORRECT, does
  NOT misfire). The decoy token is `1"` with the closing quote attached, and
  the loop tests `^[0-9]+$`, so it is skipped. The quote is what saves it.
- `echo "gh pr merge 1 " && gh pr merge 2002` -> extracts 1 (MISFIRES). One
  space before the closing quote is the whole difference.
- `echo gh pr merge 1 && gh pr merge 2002` (unquoted) -> extracts 1 (MISFIRES).
- heredoc body containing `run gh pr merge 1 later` -> extracts 1 (MISFIRES).

So the real precondition is a BARE all-digit token after a decoy gh/pr/merge
sequence - not merely a decoy sequence. Pin all four shapes, including the
quoted one as a passing case, since it is the difference between the two that
documents the actual boundary.

TRIGGER SET CORRECTED AGAIN (2026-08-08, re-derived against the extraction
logic itself rather than through the banner). The correction above is right
about the bare-digit half and WRONG about the heredoc row, so the note had the
same defect twice - a listed trigger that does not hold:

- `gh pr merge 2002 <<EOF / run gh pr merge 1 later / EOF` -> extracts 2002
  (CORRECT, does NOT misfire). Shortest-prefix removal anchors on the FIRST
  gh/pr/merge occurrence, which here is the real one, so the decoy inside the
  heredoc body is already past the anchor.
- `cat <<EOF / run gh pr merge 1 later / EOF / gh pr merge 2002` -> extracts 1
  (MISFIRES). Same heredoc, moved BEFORE the real invocation.

POSITION is the missing half of the precondition. Both must hold: a decoy
gh/pr/merge sequence positioned BEFORE the real invocation, AND a bare
all-digit token after it. Verified across `&&`, `;`, newline, and pipe
separators - all misfire when the decoy leads. A decoy that leads but carries
no bare digit (`echo gh pr merge now`, `echo gh pr merge v1`) extracts 2002
correctly.

TRIGGER SET CORRECTED A THIRD TIME (2026-08-08, from #2006's review). The
"decoy BEFORE a real invocation" framing is still too narrow: there need not
be a real invocation at all. The command match tests the whole command TEXT,
so the subcommand actually being invoked is irrelevant - measured against the
real hook, `gh pr comment N --body "... gh pr merge 1 in prose"` fetches PR 1
and `gh issue create --body "run gh pr merge 42 when ready"` fetches PR 42.
Ordinary prose about merging, in any command, is enough.

The hardening is TASK-469; the three shapes are pinned as PINNED DEFECT cases
in pr-merge-review-check.probe.sh so a fix is a deliberate act. This note has
now been wrong three times in the same direction - each correction widened the
trigger set - so treat any future "the precondition is X" claim here as a
lower bound until re-measured.

OBSERVED IN PRODUCTION, not just derived: a READ-ONLY diagnostic command that
merely discussed merges - it defined a shell function and printed case labels,
invoking no merge at all - tripped the live hook, which extracted PR #1,
fetched that PR's (absent) review, resolved its base as `main`, and printed the
release-finalize reminder. Two things follow. First, the misfire needs no
exotic construction; ordinary prose about merging with a loose digit in it is
enough. Second, the probe's own case list cannot be passed inline in a Bash
command - it will trip the hook it is testing. Write the harness to a file and
execute the file.

Impact stands as recorded: a wrong PR whose review is absent AND whose base is
not `main` exits 0, and the merge proceeds UNREVIEWED. Here it happened to
block only because the release reminder was independently due.
<!-- SECTION:DESCRIPTION:END -->
