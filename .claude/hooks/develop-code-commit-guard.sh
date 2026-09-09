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
    print("HDR:ok")
    print("ok")
    raise SystemExit

# The command before ANY stripping. The substitution scan below reads from it,
# because every strip step here is destructive by design and the nested-
# substitution shape is destroyed by the quote strip specifically.
raw_cmd = cmd

# --- commit header pre-check -------------------------------------------
# Independent of the develop/main gate below: a bad commit subject (opens
# with a task id, exceeds commitlint's header-max-length, or fails
# subject-case) is worth catching on EVERY branch, before husky's
# lint-staged pipeline burns minutes on a commit that commit-msg will
# reject anyway. Reads from raw_cmd (not the stripped `cmd`), because the
# stripping above erases message CONTENT — exactly what this needs.
def _plain_subject(segment):
    # Plain -m/--message form: quoted or bare argument. `-[a-zA-Z]*m` also
    # matches a combined short-flag cluster ending in `m` (`-am`, `-cam`) —
    # git accepts a message flag folded into a cluster like any other short
    # option, and the literal `-m` alternative alone missed it, leaving
    # `git commit -am "Bad Subject"` unchecked. `(?<!\S)` anchors the cluster
    # to a fresh flag boundary so it cannot match mid-word inside an
    # unrelated long flag (`--amend` has no standalone `-am` at a boundary —
    # the char before its embedded "-am" is itself the first `-`, which is
    # `\S`); `(?![a-zA-Z])` keeps a cluster not ending in `m` (`-ac`) from
    # matching by requiring the letter immediately after the run be absent.
    m = re.search(
        r"(?:-m|--message|(?<!\S)-[a-zA-Z]*m(?![a-zA-Z]))[=\s]+(\"([^\"]*)\"|'([^']*)'|([^\s\"']+))",
        segment,
    )
    if not m:
        return None
    val = m.group(2)
    if val is None:
        val = m.group(3)
    if val is None:
        val = m.group(4)
    if val is None:
        return None
    return val.split("\n")[0].strip()


def _subject_verdict(subject):
    if subject is None:
        return "ok"
    # Guard the verdict line's own `|`-delimited format against a subject
    # that happens to carry a pipe or an embedded newline.
    safe_subject = subject.split("\n")[0].replace("|", " ")
    length = len(subject)
    # Case-insensitive: TASK-N is the codebase's only task-id convention, and
    # a lowercase opener (`task-123 fix thing`) is the same developer mistake
    # under a different capitalization — recognizing it costs nothing and
    # closes a gap where it would otherwise slip past BOTH the taskopen rule
    # and (whenever the rest of the subject also opens lowercase) the
    # subject-case rule, passing unblocked.
    if re.match(r"^TASK-\d", subject, re.IGNORECASE):
        return f"taskopen|{length}|{safe_subject}"
    if length > 100:
        return f"length|{length}|{safe_subject}"
    prefix = re.match(r"^[a-z]+(\([^)]*\))?!?:\s+", subject)
    subject_part = subject[prefix.end():] if prefix else subject
    if subject_part[:1].isupper():
        return f"case|{length}|{safe_subject}"
    return "ok"


def _header_verdict(raw, classify_text):
    # Canonical heredoc form: -m "$(cat <<'EOF' ... EOF)" — subject is the
    # first non-blank line of the heredoc body. `[=\s]+` (not `\s+`) after the
    # flag so `--message=$(cat <<...)` isolates the same as the space form —
    # `_plain_subject` already accepts `=`, and without it here the heredoc
    # extraction never matches, falling through to the plain-form path below,
    # which finds no inline `-m`/`--message` argument either and passes an
    # over-length subject through unchecked. The trailing `\s*\)` consumes
    # through the substitution's own closing paren (mirroring the `cmd`-level
    # MSG strip above) so a match never leaves a bare newline dangling between
    # the terminator and `)` — that stray newline would otherwise register as
    # its own chain-segment separator below and desync the segment count from
    # `classify_text`, which collapsed the whole substitution (paren included)
    # to one token already.
    #
    # EVERY occurrence in `raw` is collected (`finditer`, not `search`) and
    # given its own single-line sentinel before the chain-segment split below,
    # instead of running once against the WHOLE raw command. A heredoc-shaped
    # commit example sitting in an EARLIER quoted/prose argument (a `sed`/
    # `echo` replacement quoting the canonical form — this file's own doc
    # excerpt is exactly that shape) is leftmost in raw, so a whole-raw search
    # picked its "subject" over the real, later commit's own — the heredoc
    # analogue of the round-3 plain-`-m` bug, and fixed the same way: classify
    # from quote-stripped text, extract from raw.
    heredoc_re = re.compile(
        r"(?:-m|--message)[=\s]+\"?\$\(cat\s+<<-?\s*'?\"?(\w+)'?\"?[^\n]*\n(.*?)\n\1\s*\)",
        re.S,
    )
    heredoc_matches = list(heredoc_re.finditer(raw))

    def _heredoc_subject(match):
        for line in match.group(2).split("\n"):
            line = line.strip()
            if line:
                return line
        return None

    # Plain -m/--message form AND heredoc form share one classification pass:
    # evaluate EVERY chain segment that IS a commit invocation, in order, and
    # stop at the first one whose subject fails — a chain halts at its first
    # rejected commit, so that is the one a developer actually hits. An
    # earlier command's own -m/--message (e.g. `git stash push -m "WIP"`) is
    # never itself a commit invocation, so it is never a candidate here
    # regardless of position.
    #
    # CLASSIFICATION runs on `classify_text` — the fully heredoc-stripped,
    # quote-stripped `cmd` the develop/main gate itself uses for `detected` —
    # never on raw text. A raw segment can carry `git commit`-shaped PROSE
    # inside an earlier quoted argument (a `sed` replacement quoting a commit
    # example): `is_commit_invocation` does not know about quoting, so
    # classifying from raw text misclassifies that segment as a real commit
    # and lets it supply the "subject" a real commit later in the chain never
    # had. `classify_text` has every quoted/heredoc span already collapsed to
    # a placeholder, so quoted prose carries no `git`/`commit` tokens to match.
    #
    # EXTRACTION reads `sentinel_raw` — `raw` with each heredoc match's span
    # replaced by its own single-line sentinel token, the ONLY difference
    # from `raw`, so a segment with no heredoc match is byte-identical to its
    # raw counterpart and the plain-form extraction below still reads real
    # content. Segment i of `classify_text` and segment i of `sentinel_raw`,
    # split on the same separator pattern, name the same real command
    # substring IFF splitting produces the identical segment count in both:
    # `classify_text` differs from `sentinel_raw` only by collapsing quoted/
    # heredoc spans (now sentinels too) to single-token placeholders, which
    # can only REMOVE a separator match (one that was hiding inside a span),
    # never add one — so an equal count means no separator was removed by the
    # collapse, and the two segmentations line up one-for-one. An unequal
    # count means a chain separator sat inside a quoted/heredoc span in raw
    # (naive raw-splitting already mis-segments in that case), so
    # correspondence cannot be trusted there — fall back to the single
    # whole-raw heredoc match (if any), the same safe-direction reach used
    # when no segment isolates cleanly at all.
    sentinel_parts = []
    last = 0
    for i, hm in enumerate(heredoc_matches):
        sentinel_parts.append(raw[last : hm.start()])
        sentinel_parts.append(f"\x00HD{i}\x00")
        last = hm.end()
    sentinel_parts.append(raw[last:])
    sentinel_raw = "".join(sentinel_parts)

    classify_segments = re.split(r"&&|\|\||;|\||\n", classify_text)
    sentinel_segments = re.split(r"&&|\|\||;|\||\n", sentinel_raw)
    if len(classify_segments) == len(sentinel_segments):
        commit_indices = [i for i, s in enumerate(classify_segments) if is_commit_invocation(s)]
        if commit_indices:
            for i in commit_indices:
                sentinel_match = re.search(r"\x00HD(\d+)\x00", sentinel_segments[i])
                if sentinel_match:
                    subject = _heredoc_subject(heredoc_matches[int(sentinel_match.group(1))])
                else:
                    subject = _plain_subject(sentinel_segments[i])
                verdict = _subject_verdict(subject)
                if verdict != "ok":
                    return verdict
            return "ok"
    if heredoc_matches:
        return _subject_verdict(_heredoc_subject(heredoc_matches[0]))
    return _subject_verdict(_plain_subject(raw))


def _emit(gate_verdict):
    # The header verdict is computed in ISOLATION from the gate verdict: an
    # unhandled exception here must degrade the header check to "ok" and
    # never take the develop/main review gate down with it. Without this
    # try/except, a fault anywhere in the header code raises out of the
    # whole python heredoc, the caller's `VERDICT=$(...) || exit 0` treats
    # the non-zero exit as fail-open, and BOTH checks vanish silently —
    # a bug in a subject-line convenience check would disable the
    # security-relevant develop/main commit protection too.
    header = "ok"
    if header_detected:
        try:
            header = _header_verdict(raw_cmd, cmd)
        except Exception:
            header = "ok"
    print(f"HDR:{header}")
    print(gate_verdict)
    raise SystemExit

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

# The header pre-check's own gate, captured BEFORE the substitution widening
# below: TRUE only when a commit invocation survives the top-level quote
# strip. A commit sitting inside a backtick/$(...) span that is itself nested
# inside an OUTER single-quoted argument (a `sed` replacement quoting a commit
# example, say) never executes — the outer single quote already swallowed the
# whole span into the `S` placeholder above — but the substitution scan below
# re-extracts it from the RAW text regardless (accepted over-arm; see
# substitution_spans_matching's docstring). Running `_header_verdict` on the
# FULL raw command for a match found ONLY that way picks whichever `-m` its
# own naive chain-split isolates first, which need not be the quoted
# example's own `-m`: measured, a `git stash push -m "WIP before rebase" &&
# git commit -m "real"` sequence quoted in backticks blocked on "WIP before
# rebase" — a subject nobody ever actually committed. A commit that survives
# the top-level strip (the canonical heredoc form included — its body is
# always replaced by a bare placeholder before this point) still gets the
# header check; only a substitution-only match skips it.
header_detected = detected

# Command substitutions, scanned from the RAW text. A `$(…)` or backtick span
# nested inside a QUOTED argument is erased by the quote strip above while bash
# still runs it, so `echo "$(git commit -m x)"` stripped to `echo S` and this
# guard exited 0 on a real commit (measured, all three forms). Each span gets
# the SAME cleaning the top-level scan applies to the command — heredoc bodies
# off the WHOLE raw command first, then strip_quoted per span — inside the
# shared helper (see substitution_spans_matching in lib/shell_quotes.py for the
# accepted over-arm/under-arm boundaries it documents). This widening feeds
# ONLY the develop/main review gate (`detected`), never the header pre-check
# (`header_detected`, captured above it).
if not detected and substitution_spans_matching(raw_cmd, is_commit_invocation):
    detected = True

if not detected:
    print("HDR:ok")
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
        _emit("ok")

_emit("check")
PYEOF
) || exit 0

HDR_VERDICT=$(printf '%s\n' "$VERDICT" | head -1)
GATE_VERDICT=$(printf '%s\n' "$VERDICT" | tail -1)
HDR_VERDICT="${HDR_VERDICT#HDR:}"

# --- commit header pre-check -------------------------------------------
# Runs BEFORE the develop/main branch gate (and before the `cd` it needs):
# a bad commit subject is a problem on EVERY branch, not just develop/main,
# so it must not be gated behind the branch check below. It also
# deliberately does NOT consult TZUROT_ALLOW_DEVELOP_CODE_COMMIT — that
# token unlocks the develop/doc-only gate, an orthogonal concern to header
# shape, and honouring it here would let a bad header ride through on the
# same escape hatch that exists for something else entirely.
# DIGEST_TOOL is a fixed literal (never user input), so the unquoted
# expansion below is a deliberate two-word command split, not an injection
# risk. sha256sum is preferred; shasum -a 256 is the macOS/BSD fallback.
DIGEST_TOOL=""
if command -v sha256sum >/dev/null 2>&1; then
  DIGEST_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  DIGEST_TOOL="shasum -a 256"
fi

if [ -n "$HDR_VERDICT" ] && [ "$HDR_VERDICT" != "ok" ]; then
  if [ -z "$DIGEST_TOOL" ]; then
    echo "develop-code-commit-guard (header check): no sha256 digest tool found (sha256sum/shasum) — skipping the header pre-check, failing open" >&2
  else
    HDR_REASON="${HDR_VERDICT%%|*}"
    HDR_REST="${HDR_VERDICT#*|}"
    HDR_LEN="${HDR_REST%%|*}"
    HDR_SUBJECT="${HDR_REST#*|}"
    ACK_FILE="${DEVELOP_COMMIT_HEADER_ACK_FILE:-/tmp/.claude_commit_header_ack.$(id -u)}"
    SUBJ_HASH=$(printf '%s' "$HDR_SUBJECT" | $DIGEST_TOOL | cut -d' ' -f1)
    ACK_KEY="$(date -u +%F):${SUBJ_HASH}"
    if [ -f "$ACK_FILE" ] && grep -qxF "$ACK_KEY" "$ACK_FILE" 2>/dev/null; then
      # Already acked today for this exact subject — fall through. Safe to
      # let an identical retry through unblocked: this hook is a PreToolUse
      # fast-fail in front of .husky/commit-msg -> commitlint, which
      # independently re-checks header-max-length/subject-case on the ACTUAL
      # commit message and rejects the same violation regardless of what this
      # ack file remembers.
      :
    elif ! printf '%s\n' "$ACK_KEY" >>"$ACK_FILE" 2>/dev/null; then
      echo "develop-code-commit-guard (header check): could not write ack file $ACK_FILE — failing open" >&2
    else
      chmod 600 "$ACK_FILE" 2>/dev/null || true
      case "$HDR_REASON" in
        taskopen) REASON_TEXT="opens with a task id (TASK-N) — commit subjects must not lead with the task id" ;;
        length) REASON_TEXT="is too long: commitlint header-max-length caps the full header at 100 characters" ;;
        case) REASON_TEXT="starts with an uppercase letter — commitlint subject-case requires lowercase" ;;
        *) REASON_TEXT="fails the commit header shape check" ;;
      esac
      cat >&2 <<HDRBANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMIT HEADER PRE-CHECK — commit blocked before husky ever runs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This commit's subject $REASON_TEXT (05-tooling.md § Commit Message
Format; commitlint header-max-length / subject-case).

Measured length: $HDR_LEN
Subject: $HDR_SUBJECT

git runs .husky/pre-commit (the full lint-staged pipeline) BEFORE
commit-msg, so a header trip like this costs minutes of lint-staged
work before commitlint ever reads the subject line.

Fix: rewrite the subject and re-issue the commit. An IDENTICAL retry
of this exact subject is deliberately NOT blocked again today.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HDRBANNER
      exit 2
    fi
  fi
fi

[ "$GATE_VERDICT" != "check" ] && exit 0

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
# grep DRAINS rather than `-q`-quits: under pipefail an early exit kills the
# producer with SIGPIPE and a real match reports as failure. Full reasoning
# lives above the resolver in pr-body-ref-gate.sh.
if ! printf '%s\n' "$GATED_FILES" | grep -vE '(^|/)package\.json$' >/dev/null; then
  VERSION_ONLY=1
  while IFS= read -r f; do
    if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      VERSION_ONLY=0; break   # untracked/new manifest is not a bump shape
    fi
    # ([^+-]|$): a bare +/- (added/removed EMPTY line) is still a change —
    # without the |$ alternative it would be invisible to the check.
    CHANGED=$(git diff HEAD -U0 -- "$f" 2>/dev/null | grep -E '^[+-]([^+-]|$)' || true)
    if [ -z "$CHANGED" ] \
      || printf '%s\n' "$CHANGED" | grep -vE '^[+-][[:space:]]*"version":' >/dev/null; then
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
