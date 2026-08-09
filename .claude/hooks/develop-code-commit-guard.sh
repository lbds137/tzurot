#!/bin/bash
# PreToolUse hook: block `git commit` on develop/main when review-gated files
# are in play. Direct commits to develop are doc-only by policy
# (00-critical.md § "Direct doc commits to develop"); code, CI config,
# dependency manifests, Dockerfiles, and .claude rules/skills/hooks must go
# branch → PR → review.
#
# The gate keys off the DIRTY TREE, not the staging area: the failure shape
# is an `git add … && git commit` chain, where at PreToolUse time nothing is
# staged yet — only the working tree carries the signal.
#
# Matching notes (review-hardened):
# - Heredoc bodies and quoted strings are stripped BEFORE any matching, so the
#   repo's canonical `-m "$(cat <<'EOF' … EOF)"` commit shape strips to just
#   its command skeleton instead of blinding the scan. A commit MESSAGE can
#   therefore neither trigger the guard nor supply the escape token. The quote
#   half is the SHARED scanner in lib/shell_quotes.py — this hook's own copy
#   was a two-pass strip, and it was a measured bypass (see the note at the
#   call site). The heredoc half stays local: each hook strips the heredoc
#   forms its own matching cares about.
# - A command SUBSTITUTION is scanned as its own command, from the raw text.
#   The quote strip erases a `$(…)`/backtick span nested inside a quoted
#   argument while bash still executes it, so the detection above would miss
#   `echo "$(git commit -m x)"` entirely. See the call site for the two
#   accepted imprecisions.
# - COMMIT DETECTION is case-insensitive on BOTH sides — the bash pre-filters
#   and the python regex. Either one left case-sensitive re-opens the hole on
#   its own, because the pre-filter short-circuits before python runs. The
#   ESCAPE TOKEN is deliberately exact-case and is not covered by this; see its
#   own note at the match site.
# - `git commit` matching tolerates global flags (`git -C x commit`,
#   `git --git-dir=y commit`).
# - The escape hatch is an assignment token leading ANY chain segment of the
#   command (typically the first): its presence in command position — never
#   in quoted/heredoc prose — is the deliberate, review-visible unlock for
#   the whole command. This is a visibility guard, not a security boundary,
#   so per-segment env semantics are intentionally not modeled.
# - Known limitation: the branch check runs in CLAUDE_PROJECT_DIR; a command
#   that cd's into a DIFFERENT checkout/worktree is checked against the main
#   checkout's branch. Accepted — the failure pattern this guards is in-repo.
#
# Posture note (decided at the guard-triple review): the extension match is
# a deliberate BLOCKLIST, not a default-deny allowlist. This is a
# visibility guard for the failure pattern that actually occurred (code
# staged on develop), not a security boundary — a default-deny would block
# every unenumerable doc/asset type (txt, images, csv…) and turn the guard
# into recurring friction. Cost accepted: an exotic code type absent from
# the list (.tf, .proto, extensionless scripts) bypasses; extend the list
# when one enters the repo.
#
# Fixture check: run .claude/hooks/develop-code-commit-guard.probe.sh after
# ANY edit to this file — it asserts the exit-code table over the command
# shapes that have historically been missed (canonical heredoc commit form
# included).

set -uo pipefail

# The pre-filters below are the fast path, and a case-sensitive one is a hole
# in its own right: `GIT COMMIT -m x` would exit at the raw-payload glob before
# the python regex ever ran, so making only the regex case-insensitive fixes
# nothing. Both sides change together or neither does.
# FILE-GLOBAL, and there is no reset below — every `case` and `[[ ]]` in the
# rest of this script inherits case-insensitive matching. Nothing downstream
# relies on case today (the checks past this point use `grep -E` and `[ ]`
# string equality, neither affected), but a later contributor adding a `case`
# on a filename, branch, or extension would silently get case-insensitive
# behaviour without anything at the new site saying so. If you add one and want
# exact matching, `shopt -u nocasematch` around it — do not assume the default.
shopt -s nocasematch

INPUT=$(cat)

# Raw-payload pre-check, BEFORE the two jq forks. This hook is PreToolUse on
# every Bash call, and the jq pair dominates the cost — 22.25ms -> 9.07ms per
# call (measured, 100 runs against a non-git payload) — so the decoded
# short-circuit below was saving the python spawn but not the forks.
#
# Safe on a BLOCKING guard because it can only OVER-match, never under-match:
# JSON escaping inserts backslashes at `"`, `\`, and control characters, and
# leaves ASCII letters alone, so a decoded command containing `git`…`commit`
# implies the raw payload carries those tokens too, in that order (the JSON
# envelope contains no `git` ahead of the command field). Confirmed against a
# REAL harness payload, not just jq-built probe fixtures: the sibling
# filter-guard blocked a live `git push … | tail` through this same pre-check,
# which requires the tokens to have been literal in the raw stdin.
#
# A false positive costs exactly what today already costs; a false negative is
# the only dangerous direction and this shape cannot produce one.
case "$INPUT" in
  *git*commit*) ;;
  *) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$COMMAND" ] && exit 0

# Cheap short-circuit before spawning python: no git+commit tokens at all.
case "$COMMAND" in
  *git*commit*) ;;
  *) exit 0 ;;
esac

# Absolute path to the shared hook lib, resolved before the python spawn and
# before the cd below, so the import cannot depend on the caller's cwd.
HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"

# PYTHONDONTWRITEBYTECODE: keep the import from dropping a __pycache__ into
# the hooks lib on every guarded commit (gitignored, but a stale .pyc can
# also mask a broken edit to the module).
VERDICT=$(GUARD_CMD="$COMMAND" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 << 'PYEOF'
import os
import re
import sys

# Shared with lossy-pipe-guard.sh and cwd-drift-guard.sh. An import failure
# exits non-zero, which the caller treats as allow (fail-open); the probe,
# not runtime, is what catches a missing lib.
sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import strip_quoted, substitution_spans_matching

cmd = os.environ.get("GUARD_CMD", "")
if not cmd:
    print("ok")
    raise SystemExit

# The command before ANY stripping. The substitution scan below reads from it,
# because every strip step here is destructive by design and the nested-
# substitution shape is destroyed by the quote strip specifically.
raw_cmd = cmd

# Strip $(cat <<'EOF' … EOF) commit-message substitutions, bare heredoc
# bodies, and quoted strings — each scoped to its own terminator — so
# message CONTENT can't influence the structural checks below. (A sed
# line-range delete is NOT equivalent: /<<EOF/,$d runs to end-of-buffer
# and erases the very line carrying `git commit`.)
cmd = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", cmd, flags=re.S)
cmd = re.sub(r"<<[-~]?\s*'?\"?(\w+)'?\"?.*?\n\1(?=\s|$)", "HEREDOC", cmd, flags=re.S)

# Quote stripping is a single left-to-right SCAN. The two independent regex
# passes this replaces were a BYPASS of this blocking hook, measured:
#
#     echo "it's" && git commit -m "won't"     stripped to `echo S`, exit 0
#
# The apostrophes in `it's` and `won't` paired across the `&&`, erasing the
# whole `git commit` — so a code commit could land on develop with no review
# because someone used a contraction. Note the ordering: quoted arguments AFTER
# `git commit` are harmless (the swallow happens downstream of the match); it is
# specifically an EARLIER quoted argument that hides the commit.
#
# Full rationale, both measured repros, and the unterminated-quote failure
# direction live in .claude/hooks/lib/shell_quotes.py.
scanned = strip_quoted(cmd)
if scanned is not None:
    cmd = scanned

# Kept in agreement with the other copy (lossy-pipe-guard.sh) by
# packages/tooling/src/dev/gitCommitPatternAgreement.test.ts, which extracts
# both patterns and runs them over a shared case table. Both copies BLOCK, so a
# drift between them is a wrongly-blocked or wrongly-allowed commit.
#
# `git commit` with optional global flags (-C <path>, --git-dir=…, etc.).
# The trailing (?![-\w]) is load-bearing: a plain \b would also match the
# plumbing subcommands `git commit-tree` / `git commit-graph`, because `-`
# is a non-word character and so a word boundary exists right before it.
# Those write no commit and must never be treated as one.
#
# The flag run is DETERMINISTIC, deliberately without an atomic group. `-{1,2}`
# made it re-partitionable — `--flag` parses as `--`+`flag` or `-`+`-flag`, so a
# failing match explores 2^n splits (measured: 20 double-dash flags 2.7s, 60 no
# finish in 20s). `-+[^-\s]\S*` forces the dash count by requiring a non-dash
# after it; 200 flags then take 0.24ms with every verdict unchanged.
#
# `(?>...)` would also fix it and is NOT used: atomic groups need Python 3.11,
# and on anything older re.compile raises, python exits non-zero, and the
# `|| exit 0` below silently ALLOWS the commit — this guard disabled by
# interpreter version. Ubuntu 22.04 ships 3.10; CI (3.12) would not have caught
# it.
#
# The (?i) is INLINE rather than an re.I argument: the agreement test extracts
# this pattern out of the source text, so a flag passed outside the string
# would vanish from the comparison against the sibling copy (and break the
# extraction outright, which that test treats as a hard failure).
#
# Python's \w is Unicode-aware, so this is equivalent to the bash side's
# ASCII-only ([^-a-zA-Z0-9_]|$) for every real git invocation but not for
# a non-ASCII suffix (`git commit日本語`). Deliberately NOT re.ASCII: that
# flag narrows \s in the same pattern too, so a non-breaking space between
# `git` and `commit` would stop matching and the guard would MISS a real
# commit — failing open on a pasteable input to close a hypothetical one.
#
# THE PARAMETER IS NAMED `cmd` ON PURPOSE. gitCommitPatternAgreement.test.ts
# pulls this pattern out of the source TEXT: it looks for a raw-string
# `re.search` call whose second argument is spelled `cmd`, and it requires
# EXACTLY ONE such line in the whole file. Wrapping the call in a function is
# what keeps the pattern written once while two call sites — top level, and
# each substitution span — share it. Renaming the parameter disarms that
# guard, and so does a second line of the same shape anywhere in this file,
# including inside a comment (measured while writing this one).
def is_commit_invocation(cmd):
    """True when `cmd` contains a `git commit` invocation."""
    return re.search(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+commit(?![-\w])", cmd) is not None


detected = is_commit_invocation(cmd)

# Command substitutions, scanned from the RAW text. A `$(…)` or backtick span
# nested inside a QUOTED argument is erased by the quote strip above while bash
# still runs it, so `echo "$(git commit -m x)"` stripped to `echo S` and this
# guard exited 0 on a real commit (measured, all three forms). Each span gets
# the SAME cleaning the top-level scan applies to the command — heredoc bodies
# off the WHOLE raw command first, then strip_quoted per span — inside the
# shared helper (see substitution_spans_matching in lib/shell_quotes.py for the
# accepted over-arm/under-arm boundaries it documents).
if not detected and substitution_spans_matching(raw_cmd, is_commit_invocation):
    detected = True

if not detected:
    print("ok")
    raise SystemExit

# Escape hatch: an assignment token leading a chain segment — never prose
# (prose lived in quotes/heredocs, which are already stripped).
#
# EXACT-CASE ON PURPOSE, and the asymmetry with the case-insensitive detection
# above is the point rather than an oversight. This token is an environment
# variable NAME, and bash env names are case-sensitive: `tzurot_allow_...=1`
# sets a different variable entirely. Honouring a lowercase spelling would mean
# unlocking on a token that is not the documented variable — the unlock is
# supposed to be a deliberate, review-visible act, so it recognises exactly one
# spelling. The failure direction is safe either way: an unrecognised spelling
# BLOCKS, it never bypasses.
for segment in re.split(r"&&|\|\||;|\||\n", cmd):
    if re.match(r"\s*TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1(\s|$)", segment):
        print("ok")
        raise SystemExit

print("check")
PYEOF
) || exit 0

[ "$VERDICT" != "check" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$BRANCH" != "develop" ] && [ "$BRANCH" != "main" ]; then
  exit 0
fi

# Review-gated files anywhere in the dirty tree (staged, unstaged, untracked):
# code, CI/workflow config, dependency manifests, Dockerfiles, and the
# .claude rules/skills/hooks carve-out (load-bearing .md per 00-critical.md).
# -uall is load-bearing: without it, files inside a NEW untracked directory
# collapse to `?? dir/` and no extension ever matches — a fresh package full
# of code would slip through. `cut -c4-` keeps full paths (porcelain =
# 2 status chars + space) so space-containing filenames render correctly.
# --no-renames: a staged rename otherwise renders as one `R old -> new`
# line and only the NEW path's extension gets checked — a gated→non-gated
# rename would slip through; decomposed D/A lines check both sides.
GATED_FILES=$(git status --porcelain -uall --no-renames 2>/dev/null \
  | cut -c4- \
  | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|prisma|sql|sh|yml|yaml|json|toml)$|(^|/)Dockerfile[^/]*$|^\.github/|^\.claude/(rules|skills|hooks)/' \
  || true)

if [ -z "$GATED_FILES" ]; then
  exit 0
fi

# Version-bump exception: a release bump dirties every workspace
# package.json on exactly its "version" line — the one code-shape a
# release lands directly on develop (owner call). Allowed only when ALL
# gated files are TRACKED package.json files whose full diff vs HEAD
# touches nothing but "version" lines; anything else falls through to
# the block.
if ! printf '%s\n' "$GATED_FILES" | grep -qvE '(^|/)package\.json$'; then
  VERSION_ONLY=1
  while IFS= read -r f; do
    if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      VERSION_ONLY=0; break   # untracked/new manifest is not a bump shape
    fi
    # ([^+-]|$): a bare +/- (added/removed EMPTY line) is still a change —
    # without the |$ alternative it would be invisible to the check.
    CHANGED=$(git diff HEAD -U0 -- "$f" 2>/dev/null | grep -E '^[+-]([^+-]|$)' || true)
    if [ -z "$CHANGED" ] \
      || printf '%s\n' "$CHANGED" | grep -qvE '^[+-][[:space:]]*"version":'; then
      VERSION_ONLY=0; break
    fi
  done <<< "$GATED_FILES"
  if [ "$VERSION_ONLY" = "1" ]; then
    exit 0
  fi
fi

GATED_COUNT=$(printf '%s\n' "$GATED_FILES" | wc -l)

cat >&2 <<'BANNER'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEVELOP CODE-COMMIT GUARD — commit blocked on a long-lived branch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Review-gated files are in the working tree while committing on
develop/main. Direct commits here are DOC-ONLY (00-critical.md); code,
CI config, dependency manifests, and .claude rules/skills/hooks go
branch → PR → review. This has bitten twice — hence this hook.

Dirty gated files (first 10):
BANNER
printf '%s\n' "$GATED_FILES" | head -10 >&2
if [ "$GATED_COUNT" -gt 10 ]; then
  printf '  …and %d more\n' "$((GATED_COUNT - 10))" >&2
fi
cat >&2 <<'FOOTER'

Fix: git checkout -b <type>/<name> first, then commit there.
Doc-only commit with an incidentally dirty tree? Stage ONLY the doc
files and prefix the command with TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1
(assignment position, not prose — deliberate, review-visible friction).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOOTER
exit 2
