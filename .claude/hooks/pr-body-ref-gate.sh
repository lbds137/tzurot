#!/bin/bash
# PreToolUse hook (matcher: Bash) — blocks a PR-body write whose body claims a
# tracker reference ("filed as TASK-123", "closes doc-45") that does not
# resolve on origin/develop.
#
# A PR body claiming a follow-up was "filed as TASK-N" over a task that was
# never committed is a false claim to every reader of that PR — `git
# ls-files`/`existsSync` cannot see an uncommitted tracker file from the PR's
# vantage point, and neither can the reviewer, another checkout, or the next
# session. `/tzurot-git-workflow` § "Before writing a closing reference"
# already prescribes the `git ls-tree` verification check in prose; it was
# skipped, so the correction moves to a deterministic trigger
# (00-critical.md § Fix Recurring Failures Structurally).
#
# Scope: `gh pr create`, `gh pr edit`, and `pnpm ops gh:pr-edit` invocations
# that carry `--body` or `--body-file`. Only claim-verb spans ("filed as",
# "tracked in", "closes", "completes", "finishes") followed by a TASK-N or
# doc-N id are checked — a bare mention ("see TASK-99999 for background")
# makes no claim and is deliberately left alone.
#
# Fail-open throughout: a missing origin/develop ref, a git error, an empty
# tracker/ listing, or an unsupported grep dialect all pass the command
# through rather than block it. A broken gate must never block a real PR.
# An unreadable --body-file is the one degraded case rather than a pass: the
# file's content is dropped and the command text is still scanned.
#
# KNOWN GAPS:
#   - gh's SHORT flags `-b`/`-F` are not matched. The repo's own commands
#     write the long flags (`--body`, `--body-file`), and the cheap `--body`
#     pre-filter below is what keeps this hook off the critical path of
#     every Bash call — widening it to short flags would cost every non-PR
#     command a slower pre-filter for a shape this repo doesn't produce.
#   - The scan covers the WHOLE command text, not a precisely-parsed --body
#     argument, so that the `--body "$(cat <<'EOF' … EOF)"` heredoc form —
#     the dominant shape in this repo — is covered without a shell
#     tokenizer. A reference sitting in `--title` is therefore also caught;
#     that is a claim too, so it's deliberate rather than an over-block to
#     apologize for.
#   - A QUOTED --body-file path (`--body-file "$F"`) is not extracted — the
#     path matcher stops at the quote, so the FILE's content goes unscanned
#     (fail-open direction, same family as the short-flag gap). The command
#     text itself, including any inline `--body`, is still scanned.
#   - A RELATIVE --body-file path resolves against this hook's own cwd (the
#     repo root, per the settings.json wrapper), not the wrapped command's
#     cwd — `cd sub/dir && gh pr create --body-file ./x.md` therefore fails
#     the readability check, and only that FILE's content is lost; the
#     command text is still scanned.
#   - `gh pr create --fill` sources the body from commit messages with no
#     --body flag at all, so the pre-filter passes it through unscanned.
#     Closing it would mean reconstructing the body from git log (or
#     blocking a legitimate flag); this repo's conventions never use --fill,
#     so the gap is documented rather than closed.
#
# Fixture check: run .claude/hooks/pr-body-ref-gate.probe.sh after ANY edit.

set -uo pipefail

INPUT=$(cat)

# Raw pre-filter #1, before any jq fork — same reasoning as the sibling
# lossy-pipe-guard.sh: this runs on every Bash call, so the cheapest possible
# reject dominates. CLI flags have no case variance, so a case-sensitive glob
# here is not a hole (unlike the nocasematch situation lossy-pipe-guard has
# to account for with `git commit`/`gh pr` prose).
case "$INPUT" in
  *"--body"*) ;;
  *) exit 0 ;;
esac

# Raw pre-filter #2: narrow to the PR-write command families before paying
# for jq.
case "$INPUT" in
  *"pr create"* | *"pr edit"* | *"gh:pr-edit"*) ;;
  *) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$CMD" ] && exit 0

# Command-family check on the decoded command, case-insensitively. The `gh …`
# alternative allows global flags between `gh` and `pr`, mirroring
# lossy-pipe-guard's reasoning about adjacency-only spellings missing
# `gh --repo owner/name pr create`.
if ! printf '%s' "$CMD" | grep -qiE '(gh([[:space:]]+[^[:space:]]+)*[[:space:]]+pr[[:space:]]+(create|edit))|(ops[[:space:]]+gh:pr-edit)'; then
  exit 0
fi

# Require --body or --body-file on the decoded command.
if ! printf '%s' "$CMD" | grep -qE -- '--body(-file)?\b'; then
  exit 0
fi

SCAN_TEXT="$CMD"

# --body-file: pull in the referenced file's content so a reference written
# to a file (rather than inline) is still checked.
#
# Fail-open here means "scan what we have", NOT "abandon the check". The
# extraction runs over the whole command text, so it can also grab a prose
# word out of an inline --body ("pass --body-file for large bodies" yields
# `for`); aborting on an unreadable path would let that prose skip the claim
# scan entirely. An unreadable or false-positive extraction therefore loses
# only the FILE's content — SCAN_TEXT keeps the command text, which carries
# any inline body. Probe: "prose --body-file mention still scans inline body".
BODY_FILE=$(printf '%s' "$CMD" | grep -oP -- '--body-file[= ]+\K[^\s'"'"'"]+')
RC=$?
if [ "$RC" -gt 1 ]; then
  exit 0
fi
if [ -n "$BODY_FILE" ]; then
  case "$BODY_FILE" in
    /*) RESOLVED_BODY_FILE="$BODY_FILE" ;;
    *) RESOLVED_BODY_FILE="$PWD/$BODY_FILE" ;;
  esac
  if [ -r "$RESOLVED_BODY_FILE" ]; then
    SCAN_TEXT="$SCAN_TEXT
$(cat "$RESOLVED_BODY_FILE" 2>/dev/null)"
  fi
fi

# Claim-verb spans only — a bare mention makes no claim. Intervening tokens
# are restricted to horizontal whitespace ON PURPOSE: the pattern must not
# span a newline, which keeps this conservative (a claim verb on one line and
# an unrelated id on a later line never matches).
#
# Both alternations carry a negative lookbehind so a longer word ending in a
# verb or an id does not match: `(?<![A-Za-z])` keeps `discloses`/`encloses`
# from matching the `closes` verb, and `(?<![A-Za-z-])` keeps `SUBTASK-100`
# and `asciidoc-12` from matching an id. The `-` in the id class is what
# rejects a hyphenated prefix token (`SUB-TASK-100`). The id lookbehind sits
# AFTER the `[\x60*_(\[]*` wrapper class, so a backticked or bracketed id
# still matches — the wrapper char, not a letter, is what precedes the id.
# grep runs this with -i; probed, the lookbehinds are not widened by it.
#
# The trailing `(…)*` chain picks up a comma/`and`-separated RUN of ids after
# one verb. Without it the `{0,3}` window capped a span at ~4 ids and the
# fifth was never extracted — a fail-open under-check. The chain uses only
# horizontal whitespace, preserving the no-newline invariant above.
# The optional `:?` after the verb covers GitHub's `Closes: TASK-N` colon
# convention — probed unmatched without it.
# Probes: "discloses", "SUBTASK", backticked-id, five-chained-ids, and
# colon-after-verb cases.
REF_PATTERN='(?<![A-Za-z])(filed as|tracked in|closes|completes|finishes):?([ \t]+[^ \t]+){0,3}[ \t]+[\x60*_(\[]*(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+)([\x60*_)\]]*[ \t]*[,;]?[ \t]*(and[ \t]+)?[\x60*_(\[]*(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+))*'
REF_SPANS=$(printf '%s' "$SCAN_TEXT" | grep -oPi "$REF_PATTERN")
RC=$?
if [ "$RC" -gt 1 ]; then
  exit 0
fi
if [ "$RC" -eq 1 ]; then
  exit 0
fi

IDS=$(printf '%s\n' "$REF_SPANS" | grep -oPi '(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+)' | tr 'A-Z' 'a-z' | sort -u)
# `set -o pipefail` (top of file) is what makes this RC carry a mid-pipeline
# grep failure rather than sort's status — probed: a PCRE error propagates
# as 2 through tr|sort under pipefail. Removing pipefail would silently turn
# this into a sort-only check; the [ -z "$IDS" ] below is the backstop.
RC=$?
if [ "$RC" -gt 1 ]; then
  exit 0
fi
[ -z "$IDS" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
git -C "$ROOT" rev-parse --verify --quiet origin/develop >/dev/null 2>&1 || exit 0

TASK_LIST=$(git -C "$ROOT" ls-tree -r --name-only origin/develop -- tracker/tasks/ tracker/archive/tasks/ 2>/dev/null) || exit 0
DOC_LIST=$(git -C "$ROOT" ls-tree -r --name-only origin/develop -- tracker/docs/ tracker/archive/docs/ 2>/dev/null) || exit 0

# Empty listing fail-open, per-kind: an empty listing is an infrastructure
# signal (no tracker dir on that ref, a shallow clone), never evidence that a
# specific id is missing. Ids of an empty-listing kind are SKIPPED rather than
# the whole check abandoned, so the other kind still resolves against its own
# populated listing.
MISSING=""
while IFS= read -r id; do
  [ -z "$id" ] && continue
  case "$id" in
    task-*)
      [ -z "$TASK_LIST" ] && continue
      printf '%s\n' "$TASK_LIST" | grep -qiF -- "/${id} " && continue
      ;;
    doc-*)
      [ -z "$DOC_LIST" ] && continue
      printf '%s\n' "$DOC_LIST" | grep -qiF -- "/${id} " && continue
      ;;
    *)
      continue
      ;;
  esac
  MISSING="$MISSING$id
"
done <<<"$IDS"

[ -z "$MISSING" ] && exit 0

{
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "PR BODY REF GATE — unresolved tracker reference(s)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "This PR body claims one or more tracker references that do not"
  echo "resolve on origin/develop:"
  printf '%s' "$MISSING"
  echo
  echo "These do not resolve on origin/develop. A tracker file that exists"
  echo "only in the working tree does not exist from the reviewer's"
  echo "vantage point — not \`git log\`, not another checkout, not the next"
  echo "session."
  echo
  echo "Verify (one command per unresolved id):"
  while IFS= read -r miss; do
    [ -z "$miss" ] && continue
    case "$miss" in
      task-*) VERIFY_DIR="tracker/tasks/" ;;
      *) VERIFY_DIR="tracker/docs/" ;;
    esac
    printf '  git ls-tree -r --name-only origin/develop -- %s | grep %s\n' "$VERIFY_DIR" "$miss"
  done <<<"$MISSING"
  echo
  echo "Fix: commit and push the tracker file to develop first, or correct"
  echo "the reference."
  echo
  echo "Per /tzurot-git-workflow § \"Before writing a closing reference\"."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
} >&2
exit 2
