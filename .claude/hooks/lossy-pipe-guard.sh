#!/bin/bash
# PreToolUse hook: block commands whose output MUST be read whole from being
# piped into something that discards part of it. Two rules today, each a
# (target, lossy-stage) pair:
#
#   1. git commit/push  ×  tail|head|grep|sed|awk
#      The shape that repeatedly swallowed hook rejections (commitlint,
#      pre-push gate) and let dead commits flow into "Everything up-to-date"
#      pushes or empty-branch PRs. ANY filter blocks: the output is short when
#      it works and essential when it doesn't, so there is nothing to select.
#
#   2. gh READ commands  ×  head|tail|sed -n windowing
#      `gh pr checks 2000 | tail -30` cut a red `lint` row off the TOP of the
#      list and a failing release PR was reported as green. Only TRUNCATION
#      blocks here — grep/awk/jq stay allowed, and that asymmetry is the whole
#      design (see the two filter sets below).
#
# Background: `/tzurot-git-workflow` § command-shape rules forbids rule 1 in
# prose. The rule existed but relied on agent attention across sessions; after
# the fourth recurrence the correction moved here, where the trigger is
# deterministic (00-critical.md § Fix Recurring Failures Structurally). Rule 2
# has the same history: 05-tooling.md § PR Monitoring says "never pipe review
# fetches through | tail", and the one uncovered variant is the one that
# landed. (Rule 1's precedent really is in the git-workflow SKILL; they are
# different surfaces and this comment previously credited both to the skill.)
#
# Scope is deliberately narrow: only a PIPE attached to the TARGET's own
# pipeline segment blocks. `&&` chaining, heredoc -m bodies, redirections, and
# pipes on other segments of a compound command all pass through.
#
# KNOWN GAP, threat-model boundary: an escaped TARGET name defeats the raw
# bash pre-filter before python ever runs. The scanner now unescapes correctly,
# so an escaped FILTER name is caught — but the pre-filter globs raw text for
# `git`...`commit`, and a deliberately obfuscated spelling of the target does
# not contain it. Closing that would mean unescaping before the glob, which is
# precisely the work the pre-filter exists to avoid on every Bash call.
#
# Accepted because the threat model is habitual command shapes — the pipe an
# agent reaches for out of muscle memory — not an adversary. Nobody writes an
# escaped command name by accident.
#
# KNOWN GAP, named rather than hidden: `awk "NR<=5"` truncates a gh read exactly
# as `head -5` does, and is not blocked. See the TRUNCATORS comment for why
# blocking awk is worse than the gap it would close.
#
# KNOWN OVER-BLOCK, same treatment: an UNQUOTED subshell carrying its own pipe
# (`git commit -m $(echo x | head -1) | cat`) is split into three stages rather
# than two, and the middle one begins with a filter word, so the command blocks
# even though its real trailing stage is a harmless pass-through. Heredoc
# bodies never reach this split in any spelling; a quoted subshell is absorbed by
# the quote strip. This cannot cause a bypass — it fails toward blocking — and
# is named here so the next reader who hits it recognises it rather than
# hunting a bug.
#
# BOTH RULES also scan COMMAND SUBSTITUTIONS for their target, because the quote
# strip erases a `$(…)`/backtick span nested inside a quoted argument while
# bash still runs it. That scan is command-wide rather than per-stage — its
# accepted over-block is spelled out at SPAN_CARRIES_GIT_TARGET below.
#
# This guard buys these two classes, NOT the general pattern. A `sed -n '18,40p'`
# on a source file and a grep scoped to two named files both hid information in
# the same session and neither is reachable from here — that class belongs to
# the rule text (10-working-posture.md § Lossy steps are for known output
# shapes), not to this hook. Do not read a green run as "the class is covered."
#
# Fixture check: run .claude/hooks/lossy-pipe-guard.probe.sh after ANY edit.

set -uo pipefail

# The pre-filters below are the fast path, and a case-sensitive one is a hole in
# its own right: `GIT COMMIT … | tail` would exit here before the tokenizer ever
# ran, so making only the python regexes case-insensitive would fix nothing.
# FILE-GLOBAL, and there is no reset below — every `case` and `[[ ]]` in the
# rest of this script inherits case-insensitive matching. Nothing downstream
# relies on case today (the checks past this point use `grep -E` and `[ ]`
# string equality, neither affected), but a later contributor adding a `case`
# on a filename, branch, or extension would silently get case-insensitive
# behaviour without anything at the new site saying so. If you add one and want
# exact matching, `shopt -u nocasematch` around it — do not assume the default.
shopt -s nocasematch

INPUT=$(cat)

# Raw-payload pre-check, BEFORE the two jq forks — same reasoning as the
# sibling develop-code-commit-guard.sh: this runs PreToolUse on every Bash
# call, and the jq pair dominates the cost — 22.35ms -> 9.02ms per call
# (measured, 100 runs against a non-git payload) — so the decoded short-circuit
# below was saving the python spawn but not the forks.
#
# It can only OVER-match: JSON escaping leaves ASCII letters alone and `|` is
# not an escaped character, so anything the decoded checks would accept is still
# present in the raw payload. Verified against a REAL harness payload rather
# than only jq-built fixtures — a live `git push … | tail` was blocked through
# this pre-check, which requires both the pipe and the git/push tokens to have
# been literal in the raw stdin.
#
# The `|` pattern is quoted — unquoted it would be read as case-alternation
# rather than a literal pipe, matching everything and silently deleting the
# speedup while leaving every verdict unchanged.
case "$INPUT" in
  *"|"*) ;;
  *) exit 0 ;;
esac
# The gh alternatives allow anything between `gh` and its subcommand, because
# global flags legitimately sit there (`gh --repo owner/name pr checks`). An
# adjacency-only spelling (`*"gh pr "*`) short-circuited those commands here,
# BEFORE the tokenizer could see them — so tightening the python regex alone
# left the bypass fully open. A pre-filter is a second gate, and it has to be
# widened in the same change.
#
# The cost of the looser globs is a python spawn on prose that happens to
# contain both fragments ("walk through the process") AND a pipe. Rare, and it
# ends in exit 0.
case "$INPUT" in
  *git*commit*|*git*push*|*gh*pr*|*gh*run*|*gh*api*|*"gh:"*) ;;
  *) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

GUARD_CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$GUARD_CMD" ] && exit 0

# Cheap bash-native short-circuit: the expensive structural scan only runs for
# commands that could possibly be guilty (a pipe AND a git commit/push). Every
# other Bash call — the overwhelming majority — exits here without spawning
# python (sibling hooks set the same do-cheap-checks-first precedent).
case "$GUARD_CMD" in
  *\|*) ;;
  *) exit 0 ;;
esac
case "$GUARD_CMD" in
  *git*commit*|*git*push*|*gh*pr*|*gh*run*|*gh*api*|*"gh:"*) ;;
  *) exit 0 ;;
esac

# Absolute path to the shared hook lib, resolved before the python spawn (and
# before any cd) so the import cannot depend on the caller's cwd.
HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"

# PYTHONDONTWRITEBYTECODE: importing the shared lib otherwise drops a
# __pycache__ into .claude/hooks/lib on every guarded command. It is gitignored,
# but a stale .pyc can also mask a broken edit to the module — the import
# succeeds against yesterday's bytecode. Cheaper to never write it.
VERDICT=$(GUARD_CMD="$GUARD_CMD" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 << 'PYEOF'
import os
import re
import sys

# The quote scanner is shared with develop-code-commit-guard.sh and
# cwd-drift-guard.sh; see the module docstring for why it is one
# implementation rather than three copies. An import failure exits
# non-zero, which the caller treats as allow (fail-open) — the probe is
# what catches a missing lib, not runtime.
sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import (
    HEREDOC_OPENER,
    strip_heredoc_bodies,
    strip_quoted,
    substitution_spans_matching,
)

cmd = os.environ.get("GUARD_CMD", "")
if not cmd:
    print("ok")
    raise SystemExit

# Kept before the substitutions below: one gh arm has to be decided from the
# UNSTRIPPED text (see GH_READ_TARGET).
raw_cmd = cmd

# A heredoc BODY is inert DATA, so it comes off the WHOLE command FIRST —
# before the quote strip and before the stage split, the same order
# substitution_spans_matching cleans a span in. The shared stripper is used
# rather than a local regex because it recognizes the BARE redirect form
# (`cat <<'TAG' | tail`) as well as the `$(cat <<'EOF' … EOF)` commit-message
# spelling. A local regex matching only the $(...) form left the bare form
# untouched, so each body line stayed its own pipeline segment and a line
# merely QUOTING an example command — a target token, a pipe and a filter
# together, exactly what this repo's own incident-documenting commits contain
# — false-blocked. Pinned in both directions by the "prose inside a bare
# heredoc" and "the same text as a REAL command" cases in the probe.
cmd = strip_heredoc_bodies(cmd)

# The stripper preserves the opener line and the newlines around the removed
# body, so a heredoc-fed command stays a MULTI-LINE command and its trailing
# `) | tail` lands in a later chain segment than the target. Collapse the
# emptied heredoc back onto its opener line so the target and the truncator
# stay in one segment — pinned by the "heredoc message + real trailing tail"
# cases in the probe, which block only if this join happens.
#
# The opener half is the SHARED pattern rather than a second spelling of it.
# Re-typing it here dropped the `(?<!<)` here-string lookbehind the shared one
# carries, and a here-string followed on the next line by a piped command then
# joined into one segment and false-blocked — pinned by the "here-string is not
# a heredoc opener to rejoin" case in the probe, which exits 0 only while the
# lookbehind is inherited. Composing by string keeps ONE opener definition; the
# replacement template rebuilds the opener from that pattern's groups (1 = the
# `-` indent flag, 2 = the quote character, 3 = the marker), a coupling the
# shared pattern's own comment names as its exported contract.
#
# ACCEPTED OVER-BLOCK, and its boundary is wider than the two-heredoc shape that
# first surfaced it. The trailing `\n+\s*` matches whatever follows the emptied
# opener line, with no check that the text CONTINUES the same statement — so ANY
# heredoc whose opener line carries a target is glued onto the next line, and if
# that next line holds a lossy stage the two read as one pipeline and block,
# where bash runs them as separate statements and pipes the target into nothing.
# A single heredoc-fed commit followed by an unrelated filtered command is the
# base case; two SEQUENTIAL heredocs are one instance of the same class rather
# than its boundary, because the substitution is global and carries no state
# tying it to the heredoc just emptied. Pinned by BOTH the "single heredoc
# rejoins onto an unrelated following statement" and "back-to-back heredocs
# merge onto one scan line" cases in the probe. Left as-is: it fails toward
# over-blocking, the direction this file already accepts elsewhere (the
# `[a-z]*grep` family and the command-wide substitution span both over-match by
# design), and the cost is one re-run without the pipe against a bypass on the
# other side. Not free, though: commit-then-check is an ordinary command shape,
# so the narrowing that would remove the class — fire the rejoin only when the
# following text continues the statement, which for the `$(cat <<EOF … EOF) |
# tail` form means a remainder beginning with `)` — is real work with its own
# canary set, not a nicety.
cmd = re.sub(HEREDOC_OPENER.pattern + r"\n+\s*", r"<<\1\2\3\2 ", cmd)

# Quote stripping is a single left-to-right SCAN, not a pair of regex passes:
# the two-pass version failed on ordinary English (an apostrophe in one
# argument pairing with one in a later argument, erasing the real pipe
# between them). Rationale, the measured repros, and the unterminated-quote
# failure direction all live in .claude/hooks/lib/shell_quotes.py.
scanned = strip_quoted(cmd)
if scanned is not None:
    cmd = scanned

# Normalize bash's `|&` shorthand (2>&1 |) so the splitter sees a plain pipe.
cmd = cmd.replace("|&", "|")

# Split into chain segments (&&, ||, ;, newlines), then each segment into
# pipeline stages. A target stage with a lossy stage ANYWHERE downstream in
# the same pipeline blocks — `| cat | tail` must not defeat the guard, while
# pure pass-throughs (cat/tee) on their own stay allowed.

# Rule 1's lossy set: ANY filter. git commit/push output is short when it works
# and essential when it doesn't, so there is no legitimate reason to select
# from it.
# `[a-z]*grep` catches the family — egrep, fgrep, zgrep — which were slipping
# through as the same tool under another name. It also matches `pgrep`/`rgrep`,
# which do not filter piped stdin at all, so those over-block. Named here so a
# future reader debugging that false positive finds the reasoning rather than
# assuming a bug: over-blocking is the recoverable direction, and enumerating
# the real family exactly would drift as new spellings appear.
FILTERS = re.compile(r"(?i)^\s*(tail|head|[a-z]*grep|sed|awk)\b")

# Rule 2's lossy set: TRUNCATORS ONLY — and the difference from FILTERS is the
# entire design of this rule, not an oversight.
#
# head/tail discard by POSITION and cannot report what they dropped: the
# incident was a red `lint` row sitting at the TOP of a check list that
# `| tail -30` silently removed. grep/awk/jq select by PREDICATE, so their
# emptiness is itself an answer — and the CORRECT query for the same command,
# `gh pr checks N | awk -F'\t' '$2 != "pass"'`, is a filter whose whole purpose
# is to surface failures. A guard that fires on the correct query gets routed
# around, and a routed-around guard is worse than none.
#
# `sed` is blocked OUTRIGHT here, not only in its `-n` forms. The narrower rule
# rested on a claim that is simply false: "without -n, sed prints every line".
# `sed "5q"` quits after line 5 and is exactly `head -5`, with no -n anywhere.
#
# It cannot be distinguished by inspection either — the script is QUOTED, so by
# the time this regex runs the stage reads `sed S` and the program is gone. The
# choice is therefore block-all-sed or miss the truncating forms, and a
# substitution piped off a gh read is rare enough that over-blocking it costs
# one re-run.
#
# `awk` is NOT blocked, and that asymmetry is deliberate rather than an
# oversight. `awk "NR<=5"` truncates identically and is equally invisible — but
# blocking awk would block `awk -F'\t' '$2 != "pass"'`, the query this rule's
# own message RECOMMENDS. A guard that fires on the query it tells you to use
# is a guard people route around, which costs more than the gap. Named in the
# scope-honesty note in the header rather than papered over.
#
# The -n arm is deliberately loose about WHERE and HOW the flag is written.
# Requiring a standalone `-n` as the first token after `sed` missed every
# ordinary variant — `sed -ne '5,20p'` and `sed -rn ...` (a `\b` cannot fire
# mid-token, so the combined forms did not match at all) and `sed --posix -n`
# (the flag was not first). Those truncate identically, so matching only the
# tidiest spelling is a gap dressed as a rule.
#
# KNOWN OVER-BLOCK, accepted: `tail -n +5` prints from line 5 to the END and is
# not a positional cut, but TRUNCATORS matches on the command name and does not
# read arguments. Blocking it costs one re-run; teaching the guard to parse
# arguments to permit some `tail` invocations adds a bypass surface to buy back
# a rare convenience. Over-blocking is the recoverable direction.
TRUNCATORS = re.compile(r"(?i)^\s*(head|tail|sed)\b")
# Kept in agreement with the other copy (develop-code-commit-guard.sh) by
# packages/tooling/src/dev/gitCommitPatternAgreement.test.ts, which extracts
# both patterns and runs them over a shared case table. Both copies BLOCK, so a
# drift between them is a wrongly-blocked or wrongly-allowed commit. Note this
# copy detects (commit|push); the agreement table is push-free so the
# alternation is inert.
#
# Tolerate git global flags between `git` and the subcommand:
# -C <path>, -c k=v, --no-pager, --git-dir=..., etc.
# The trailing (?![-\w]) sits OUTSIDE the alternation so it guards both
# branches: a plain \b would also match the plumbing subcommands
# `git commit-tree` / `git commit-graph`, because `-` is a non-word
# character and so a word boundary exists right before it. Piping those
# through a filter swallows nothing this guard cares about. Guarding the
# push branch also kills a `git push-all` false positive.
#
# Python's \w is Unicode-aware, so this is equivalent to the bash side's
# ASCII-only ([^-a-zA-Z0-9_]|$) for every real git invocation but not for
# a non-ASCII suffix (`git commit日本語`). Deliberately NOT re.ASCII: that
# flag narrows \s in the same pattern too, so a non-breaking space between
# `git` and `commit` would stop matching and the guard would MISS a real
# commit — failing open on a pasteable input to close a hypothetical one.
GIT_TARGET = re.compile(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+(commit|push)(?![-\w])")

# BOTH RULES: the target hiding inside a command SUBSTITUTION. A `$(…)` or
# backtick span nested in a QUOTED argument is erased whole by the quote strip
# above while bash still executes it, so `echo "$(git commit -m x)" | tail`
# reached the stage scan as `echo S | tail` and matched no target. The same
# shape hides a gh READ from rule 2 — `echo "$(gh pr checks 2000)" | tail` — so
# BOTH targets get the scan, not just git (the gh flag is built with
# GH_READ_TARGET below, once it exists). The shared helper cleans each span
# exactly as the top-level scan cleans the command (heredoc bodies off the whole
# raw command first, then strip_quoted per span), so a quoted argument that
# merely MENTIONS a target — `$(gh pr comment --body "git push …") | tail` — is
# inert prose, not a false block. See substitution_spans_matching in
# lib/shell_quotes.py for the boundaries.
#
# COMMAND-WIDE, NOT PER-STAGE, and that is an accepted OVER-BLOCK rather than an
# oversight: the stage split runs on the STRIPPED text, where the span no longer
# exists, so there is no offset left to tie a span back to the stage that
# carried it. The consequence is that a command holding BOTH a target-bearing
# substitution and any filtered pipeline blocks, even when the two are in
# different segments. Over-blocking costs one re-run without the pipe; the
# under-arm it replaces is a swallowed commit/push failure or a truncated gh
# read, which is the whole reason this hook exists. Pinned by the "quoted
# substitution hides the commit/target from the pipe scan" cases in
# lossy-pipe-guard.probe.sh.
#
# The substitution is only ever read for a rule's target, never fed to the
# pipe segmentation — a `|` inside a substitution is that subshell's pipeline,
# not this command's, and treating it as a stage boundary would invent stages
# bash never runs.
SPAN_CARRIES_GIT_TARGET = substitution_spans_matching(
    raw_cmd, lambda span: GIT_TARGET.search(span) is not None
)

# Rule 2's targets: gh READ commands whose output has to be seen whole.
# Global flags may sit between `gh` and its subcommand, exactly as GIT_TARGET
# already tolerates for git. Without this, `gh --repo owner/name pr checks |
# tail` slipped past the whole rule — and `--repo`/`-R` is gh's standard way to
# target another repo, not an exotic spelling.
# `-+[^-\s]\S*` — any run of dashes followed by a MANDATORY non-dash — is what
# keeps this pattern from backtracking catastrophically.
#
# The blowup came from `-{1,2}`: `--flag` reads as `--`+`flag` or `-`+`-flag`,
# so a FAILING match re-partitioned every flag in the run, 2^n ways. Measured on
# `git` plus N double-dash flags that never reach a subcommand: 20 flags 2.7s,
# 60 flags did not finish inside 20 seconds. On a PreToolUse hook that is a
# session hang, not a slow command. Requiring a non-dash after the dashes forces
# the dash count, so there is nothing left to re-partition: 200 flags in 0.24ms,
# 1000 in 1.3ms, every verdict unchanged.
#
# It was NOT the optional VALUE, checked by measuring the shapes separately:
# single-dash flags WITH values run 0.6ms at 60. The earlier "a value may not
# start with `-`" restriction was never the fix it was documented as.
#
# WHY NOT AN ATOMIC GROUP `(?>...)`, which is the obvious fix and was written
# first: it needs Python 3.11. On anything older `re.compile` raises, python
# exits non-zero, and the caller's `|| exit 0` silently ALLOWS the command —
# a blocking guard disabled by interpreter version, which is this hook's own
# bug class wearing a different hat. Ubuntu 22.04 still ships 3.10, and CI
# (3.12) would never have caught it. The deterministic spelling needs no
# version floor.
#
# A negative lookahead forbidding the flag VALUE from being the subcommand sat
# here too and was REMOVED, because it was inert: it was required only to keep
# the ATOMIC version from swallowing `commit` as `--no-pager`'s value, and with
# ordinary backtracking restored it changed no verdict (including
# `git --x commit`, the shape it literally described) and no timing at any size
# from 60 to 1000 flags. It survived the atomic group's deletion by inertia and
# kept a comment claiming a job it no longer did.
#
# KNOWN NARROWING, accepted: a bare `--` is no longer read as a flag, so
# `git -- commit` stops matching. That is not a commit — git answers `unknown
# option: --` and exits 129 (verified, not assumed) — so the old behaviour was
# over-detecting a non-command.
#
# WHY THIS WENT UNMEASURED for a whole PR, since this comment once claimed the
# opposite: the timing probe built its flags as `-x0 -x1 …` — SINGLE dash, so
# `-{1,2}` has exactly one parse and the ambiguity is never reached — and on the
# gh side placed them after the subcommand, where this group cannot consume them
# at all. It measured a shape with no ambiguity in it and reported the pattern
# safe. Both probes now use double-dash flags with values, positioned to reach
# the group, and each is canaried by reverting the fix.
GH_FLAGS = r"(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*"
GH_READ_PARTS = [
    r"\bgh" + GH_FLAGS + r"\s+pr\s+(checks|view)(?![-\w])",
    r"\bgh" + GH_FLAGS + r"\s+run\s+list(?![-\w])",
    # The ops READ wrappers, enumerated rather than globbed. A `gh:[a-z-]+`
    # pattern was tried and is too wide: it swept in `gh:pr-edit`, a WRITE
    # command whose output is a confirmation line, not a list anyone must read
    # whole. That produced pure friction — it blocked `gh:pr-edit --help | tail`
    # during this PR's own authoring, twice. Rule 2 exists for reads whose rows
    # can hide a failure; a write command has no rows to lose.
    # DRIFT RISK, named rather than hidden: nothing ties this list to the
    # command registry in packages/tooling/src/commands/gh.ts, so a future
    # gh: READ wrapper is unprotected by rule 2 until someone adds it here.
    # Enumerated anyway — the `gh:[a-z-]+` glob that would self-maintain
    # swept in the WRITE command gh:pr-edit and produced pure friction.
    r"\bgh:(pr-all|pr-comments|pr-conversation|pr-info|pr-reviews|ci-gate)(?![-\w])",
]
# `gh api` is conditional, and the condition is not squeamishness: an api URL
# is quoted, so the path segment naming comments/reviews has ALREADY been
# replaced by the quote-stripping above and cannot be matched here. Deciding
# this one arm from raw_cmd is what keeps the rule at the approved scope
# (comment/review fetches) instead of every `gh api` call. It can only
# over-match — a `--body` mentioning "reviews" alongside a piped `gh api` would
# block — and over-matching here costs one re-run without the pipe.
if re.search(r"(?i)\bcomments?\b|\breviews?\b", raw_cmd):
    GH_READ_PARTS.append(r"\bgh" + GH_FLAGS + r"\s+api(?![-\w])")
GH_READ_TARGET = re.compile("(?i)" + "|".join(GH_READ_PARTS))

# The gh half of the substitution scan (see SPAN_CARRIES_GIT_TARGET above for
# the full reasoning and the accepted command-wide over-block). Symmetric with
# git: `echo "$(gh pr checks 2000)" | tail` truncates a gh read exactly as the
# direct pipe would, and without this the captured read hides from the stage
# scan. Pinned by "quoted substitution hides the gh read from the pipe scan" in
# lossy-pipe-guard.probe.sh.
SPAN_CARRIES_GH_TARGET = substitution_spans_matching(
    raw_cmd, lambda span: GH_READ_TARGET.search(span) is not None
)
SPAN_TARGET_HITS = {"git": SPAN_CARRIES_GIT_TARGET, "gh": SPAN_CARRIES_GH_TARGET}

# (target, lossy-stage, rule-name). Two different lossy sets is exactly why
# this is a list of pairs rather than one target regex: rule 1 blocks any
# filter, rule 2 blocks only truncation.
RULES = [(GIT_TARGET, FILTERS, "git"), (GH_READ_TARGET, TRUNCATORS, "gh")]

# A leading REDIRECT does not stop a stage from being a filter. `git push |
# 2>&1 tail -20` is valid bash and identical in effect to putting the redirect
# before the pipe, but the stage text then starts with `2>&1` and the anchored
# FILTERS/TRUNCATORS patterns miss it entirely — a bypass of rule 1's "any
# filter blocks" guarantee. Stripping is the safe direction: it can only make a
# stage MORE likely to match.
REDIRECT_PREFIX = re.compile(r"^\s*(?:\d*[<>]{1,2}&?\d*\s*)+")


def stage_head(stage):
    """The stage with any leading redirections removed, for command matching."""
    return REDIRECT_PREFIX.sub("", stage, count=1)


for segment in re.split(r"&&|\|\||;|\n", cmd):
    stages = segment.split("|")
    for i, stage in enumerate(stages[:-1]):
        for target, lossy, name in RULES:
            hit = target.search(stage) or SPAN_TARGET_HITS.get(name, False)
            if hit and any(lossy.match(stage_head(later)) for later in stages[i + 1 :]):
                print("block:" + name)
                raise SystemExit
print("ok")
PYEOF
) || exit 0

case "$VERDICT" in
  block:git | block:gh) ;;
  *) exit 0 ;;
esac

if [ "$VERDICT" = "block:git" ]; then
  cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOSSY PIPE GUARD — commit/push output filtered
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This command pipes `git commit` or `git push` output through a filter
(tail/head/grep/sed/awk). That shape has repeatedly swallowed hook
rejections (commitlint subject-case, pre-push gates) — the failure
scrolls away, a chained push lands nothing ("Everything up-to-date")
or an empty branch.

Per /tzurot-git-workflow § command-shape rules:
  - Run `git commit` / `git push` with UNFILTERED output. It is short
    when things work and essential when they don't.

Re-run the same commit/push without the pipe.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
else
  cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOSSY PIPE GUARD — gh read output truncated
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This pipes a `gh` READ command into head/tail/`sed -n` — a positional
cut, which cannot tell you what it dropped. `gh pr checks N | tail -30`
cut a red `lint` row off the TOP of the list and a FAILING release PR
was reported as green.

Truncation is blocked; SELECTION is not. Use a predicate, whose
emptiness is itself an answer:

  gh pr checks N | awk -F'\t' '$2 != "pass"'     # only non-passing rows
  gh pr checks N | grep -v pass                   # same idea, cruder
  gh api ... --jq '...'                           # select server-side

Or just run it unfiltered and read the whole thing.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
fi
exit 2
