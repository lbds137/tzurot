#!/bin/bash
# PreToolUse hook: block `git commit`/`git push` commands whose output is piped
# through a filter (tail/head/grep/sed/awk) — the command shape that repeatedly
# swallowed hook rejections (commitlint, pre-push gate) and let dead commits
# flow into "Everything up-to-date" pushes or empty-branch PRs.
#
# Background: `/tzurot-git-workflow` § command-shape rules forbids the pattern
# ("never filter commit/push output"). The rule existed but relied on agent
# attention across sessions; after the fourth recurrence the correction moved
# here, where the trigger is deterministic (00-critical.md § Fix Recurring
# Failures Structurally).
#
# Scope is deliberately narrow: only a PIPE attached to the git commit/push
# pipeline segment blocks. `&&` chaining, heredoc -m bodies, redirections, and
# pipes on other segments of a compound command all pass through.

set -uo pipefail

INPUT=$(cat)
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
  *git*commit*|*git*push*) ;;
  *) exit 0 ;;
esac

VERDICT=$(GUARD_CMD="$GUARD_CMD" python3 << 'PYEOF'
import os
import re

cmd = os.environ.get("GUARD_CMD", "")
if not cmd:
    print("ok")
    raise SystemExit

# Remove $(cat <<'EOF' ... EOF) substitutions (commit-message heredocs) and
# quoted strings so message CONTENT can't false-positive the structure scan.
cmd = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", cmd, flags=re.S)
cmd = re.sub(r"'[^']*'", "S", cmd)
cmd = re.sub(r'"[^"]*"', "S", cmd)

# Normalize bash's `|&` shorthand (2>&1 |) so the splitter sees a plain pipe.
cmd = cmd.replace("|&", "|")

# Split into chain segments (&&, ||, ;, newlines), then each segment into
# pipeline stages. A commit/push stage with a filter ANYWHERE downstream in
# the same pipeline blocks — `| cat | tail` must not defeat the guard, while
# pure pass-throughs (cat/tee) on their own stay allowed.
FILTERS = re.compile(r"^\s*(tail|head|grep|sed|awk)\b")
# Kept in agreement with the other two copies (lib/git-command.sh and
# develop-code-commit-guard.sh) by
# packages/tooling/src/dev/gitCommitPatternAgreement.test.ts, which extracts all
# three patterns and runs them over a shared case table. Note this copy detects
# (commit|push); the agreement table is push-free so the alternation is inert.
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
GIT_TARGET = re.compile(r"\bgit(\s+-{1,2}\S+(\s+\S+)?)*\s+(commit|push)(?![-\w])")
for segment in re.split(r"&&|\|\||;|\n", cmd):
    stages = segment.split("|")
    for i, stage in enumerate(stages[:-1]):
        if GIT_TARGET.search(stage) and any(
            FILTERS.match(later) for later in stages[i + 1 :]
        ):
            print("block")
            raise SystemExit
print("ok")
PYEOF
) || exit 0

[ "$VERDICT" != "block" ] && exit 0

cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMIT/PUSH FILTER GUARD — command blocked
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
exit 2
