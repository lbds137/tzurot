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

MEMBER: `.claude/hooks/pr-monitor-reminder.sh` has no probe.sh either. It is PR-flow-critical (it is the artifact that tells the agent to arm the CI monitor, and as of #1989 to stop the prior one), and its logic is non-trivial — PR-number resolution with a `gh pr create` stdout path plus a `gh pr list` fallback, a tag-push exclusion, per-(PR,SHA) dedup, and an assignee backfill. A probe would pin the banner's required lines and the exclusion branches against a synthetic hook payload.

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
