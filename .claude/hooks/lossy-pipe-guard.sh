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
# even though its real trailing stage is a harmless pass-through. Only the
# `$(cat <<…)` heredoc form is special-cased; a quoted subshell is absorbed by
# the quote strip. This cannot cause a bypass — it fails toward blocking — and
# is named here so the next reader who hits it recognises it rather than
# hunting a bug.
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

VERDICT=$(GUARD_CMD="$GUARD_CMD" python3 << 'PYEOF'
import os
import re

cmd = os.environ.get("GUARD_CMD", "")
if not cmd:
    print("ok")
    raise SystemExit

# Kept before the substitutions below: one gh arm has to be decided from the
# UNSTRIPPED text (see GH_READ_TARGET).
raw_cmd = cmd

# Remove $(cat <<'EOF' ... EOF) substitutions (commit-message heredocs) and
# quoted strings so message CONTENT can't false-positive the structure scan.
# `<<-?` covers the INDENTED heredoc form by design. It was surviving only by
# accident before — the double-quote strip below spans newlines and happened to
# collapse the whole $(...) span. That accident holds only while the heredoc
# sits inside one contiguous quoted span; a bare heredoc redirect with no $(...)
# wrapper leaves each body line as its own pipeline segment, and a body line
# quoting an example command (a target token, a pipe, and a filter together —
# exactly what this repo's own incident-documenting commits contain) would
# false-block.
cmd = re.sub(r"\$\(cat <<-?'?\"?(\w+)'?\"?.*?\n\s*\1\s*\)", "MSG", cmd, flags=re.S)

# Quote stripping is a single left-to-right SCAN, not a pair of regex passes.
#
# The two-pass version (strip every single-quoted span, then every double-quoted
# span) paired raw quote characters with no notion of which quote type was
# already open. That is not a corner case — it failed on ordinary English:
#
#     git commit -m "it's" | grep "isn't"          MEASURED: exited 0
#
# The single-quote pass paired the apostrophe in `it's` with the one in `isn't`,
# erasing the closing double quote, the real pipe and `grep` sitting between
# them. Rule 1's exact protected shape, allowed, because someone used a
# contraction in a commit message.
#
# Swapping the pass order only mirrors the bug — a literal `"` inside a
# single-quoted argument then pairs the same naive way — so the strategy has no
# correct ordering. It needs STATE. The scanner tracks which quote is open and
# treats the other quote character as ordinary text while inside it, which also
# subsumes the two backslash-neutralization passes this replaces:
#
#   * outside quotes, and inside "..." , a backslash escapes the next character
#   * inside '...' , bash gives backslash NO meaning at all
#
# An UNTERMINATED quote strips NOTHING, for the same reason strip_heredocs
# leaves an unterminated heredoc alone: dropping to end-of-text would delete a
# real invocation and produce a bypass, where keeping the text merely over-arms.
def strip_quoted(text):
    """Replace each quoted span with `S`. Returns None if a quote is unclosed."""
    out = []
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote is None:
            if ch == "\\" and i + 1 < len(text):
                # Outside quotes bash lets a backslash escape ANY character, and
                # the escaped character keeps its own value — `t\\ail` runs tail.
                # Collapsing every escape to a placeholder therefore HID command
                # names from the scan: measured, a commit piped into that
                # spelling of tail exited 0 while bash ran it as tail exactly as
                # written. Emit the real character instead; only an escaped
                # QUOTE needs a placeholder, so it cannot open a span.
                nxt = text[i + 1]
                # Re-emit the escaped character — EXCEPT the ones that are
                # syntax to the splitters below. An escaped `|` is a literal
                # pipe character in an argument, not a pipeline operator, but
                # once the backslash is gone `segment.split("|")` cannot tell
                # the difference: measured, `git commit -m x\\|tail` blocked as
                # though the commit were piped into tail, when bash runs no
                # pipeline at all. Same reasoning for the chain separators.
                # A placeholder keeps the character from acting as syntax while
                # preserving the token boundary.
                out.append("Q" if nxt in "\"'|&;\n" else nxt)
                i += 2
                continue
            if ch in "\"'":
                quote = ch
                out.append("S")
            else:
                out.append(ch)
        elif quote == '"':
            if ch == "\\" and i + 1 < len(text):
                i += 2
                continue
            if ch == quote:
                quote = None
        else:
            # Inside single quotes there are no escapes; only the closing
            # quote ends the span.
            if ch == quote:
                quote = None
        i += 1
    return None if quote is not None else "".join(out)


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
GIT_TARGET = re.compile(r"(?i)\bgit(\s+-{1,2}\S+(\s+[^-\s]\S*)?)*\s+(commit|push)(?![-\w])")

# Rule 2's targets: gh READ commands whose output has to be seen whole.
# Global flags may sit between `gh` and its subcommand, exactly as GIT_TARGET
# already tolerates for git. Without this, `gh --repo owner/name pr checks |
# tail` slipped past the whole rule — and `--repo`/`-R` is gh's standard way to
# target another repo, not an exotic spelling.
# A flag's VALUE may not itself start with `-`. That restriction is not
# cosmetic — it removes an ambiguity that made this pattern backtrack
# CATASTROPHICALLY. With a bare `\S+` value, every token in a run of flags can
# be read either as the previous flag's value or as a new flag, so a failing
# match explores exponentially many partitions. Measured on `gh` plus N dummy
# flags that never reach a subcommand: 18 flags 4.9ms, 22 flags 34ms, 26 flags
# 231ms — doubling every two. Roughly 34 flags would hang for minutes.
#
# This hook is PreToolUse on EVERY Bash call, so that is a session hang, not a
# slow command. After the fix: 200 flags in 0.17ms, with every verdict
# unchanged.
GH_FLAGS = r"(?:\s+-{1,2}\S+(?:\s+[^-\s]\S*)?)*"
GH_READ_PARTS = [
    r"\bgh" + GH_FLAGS + r"\s+pr\s+(checks|view)(?![-\w])",
    r"\bgh" + GH_FLAGS + r"\s+run\s+list(?![-\w])",
    # The ops READ wrappers, enumerated rather than globbed. A `gh:[a-z-]+`
    # pattern was tried and is too wide: it swept in `gh:pr-edit`, a WRITE
    # command whose output is a confirmation line, not a list anyone must read
    # whole. That produced pure friction — it blocked `gh:pr-edit --help | tail`
    # during this PR's own authoring, twice. Rule 2 exists for reads whose rows
    # can hide a failure; a write command has no rows to lose.
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
            if target.search(stage) and any(
                lossy.match(stage_head(later)) for later in stages[i + 1 :]
            ):
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
