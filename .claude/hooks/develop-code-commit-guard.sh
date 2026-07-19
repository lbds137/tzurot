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
# - Heredoc bodies and quoted strings are stripped BEFORE any matching (the
#   sibling git-commit-filter-guard.sh python technique — delimiter-scoped,
#   so the repo's canonical `-m "$(cat <<'EOF' … EOF)"` commit shape strips
#   to just its command skeleton instead of blinding the scan). A commit
#   MESSAGE can therefore neither trigger the guard nor supply the escape
#   token.
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

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$COMMAND" ] && exit 0

# Cheap short-circuit before spawning python: no git+commit tokens at all.
case "$COMMAND" in
  *git*commit*) ;;
  *) exit 0 ;;
esac

VERDICT=$(GUARD_CMD="$COMMAND" python3 << 'PYEOF'
import os
import re

cmd = os.environ.get("GUARD_CMD", "")
if not cmd:
    print("ok")
    raise SystemExit

# Strip $(cat <<'EOF' … EOF) commit-message substitutions, bare heredoc
# bodies, and quoted strings — each scoped to its own terminator — so
# message CONTENT can't influence the structural checks below. (A sed
# line-range delete is NOT equivalent: /<<EOF/,$d runs to end-of-buffer
# and erases the very line carrying `git commit`.)
cmd = re.sub(r"\$\(cat <<'?\"?(\w+)'?\"?.*?\n\1\s*\)", "MSG", cmd, flags=re.S)
cmd = re.sub(r"<<[-~]?\s*'?\"?(\w+)'?\"?.*?\n\1(?=\s|$)", "HEREDOC", cmd, flags=re.S)
cmd = re.sub(r"'[^']*'", "S", cmd)
cmd = re.sub(r'"[^"]*"', "S", cmd)

# `git commit` with optional global flags (-C <path>, --git-dir=…, etc.).
if not re.search(r"\bgit(\s+-{1,2}\S+(\s+\S+)?)*\s+commit\b", cmd):
    print("ok")
    raise SystemExit

# Escape hatch: an assignment token leading a chain segment — never prose
# (prose lived in quotes/heredocs, which are already stripped).
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
