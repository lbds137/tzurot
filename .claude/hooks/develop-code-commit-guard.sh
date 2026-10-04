#!/bin/bash
# PreToolUse hook: block `git commit` on develop/main when review-gated files
# are in play. Direct commits to develop are doc-only by policy
# (00-critical.md § "Direct doc commits to develop"); code, CI config,
# dependency manifests, Dockerfiles, and .claude rules/skills/hooks must go
# branch → PR → review.
#
# The NO-override gate keys off the DIRTY TREE, not the staging area: the
# failure shape is an `git add … && git commit` chain, where at PreToolUse
# time nothing is staged yet — only the working tree carries the signal. The
# OVERRIDE path is the opposite seam: the token exists for doc-only commits,
# so what it must judge is what the commit would actually capture, and a
# gated file in that set blocks even under the token (probe: "override:
# staged .ts blocks, banner names the file"). That set is only knowable when
# nothing else in the command can change it, so the token commit must STAND
# ALONE: one command, the token plus `git [globals] commit [flags]`, with no
# other segment, subshell, substitution (the heredoc message excepted) or
# auto-staging flag (probe: the "override: standalone rule" rows). The
# commit set is then exactly the index, which is classified like the dirty
# tree is.
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
#   so per-segment env semantics are intentionally not modeled. The unlock
#   covers the doc-only gate only: a token found in ANY segment routes the
#   command to the override path, which refuses every shape but the
#   standalone token commit and then classifies the index.
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
from shell_quotes import strip_quoted, substitution_spans, substitution_spans_matching

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
# whole span into the `S` placeholder above. The substitution scan below now
# skips a span opening inside a single-quoted region too (see
# substitution_spans' docstring), but any span it DOES extract — a
# double-quoted one, or one its quote tracking reads as unquoted — still
# counts only toward `detected`. Running `_header_verdict` on the
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
# single-quote skip and the under-arm boundaries it documents). This widening feeds
# ONLY the develop/main review gate (`detected`), never the header pre-check
# (`header_detected`, captured above it).
if not detected and substitution_spans_matching(raw_cmd, is_commit_invocation):
    detected = True

if not detected:
    print("HDR:ok")
    print("ok")
    raise SystemExit

# --- the override path: the token commit must STAND ALONE ----------------
# The token used to emit "ok" unconditionally — a blanket pass that let a
# pre-staged INDEX full of code ride a doc-only commit. What a commit captures
# is the index PLUS whatever the rest of the same command stages or rewrites
# before the commit runs, and modelling that rest (add targets, a verb
# allowlist, subshells, substitutions) missed one more bash shape every review
# round. So under the token this guard models nothing beyond the commit
# itself: the command must be the token commit ALONE, and then the commit set
# IS the index, which the caller classifies with `git diff --cached`.
# Everything else is refused with a reason, never guessed at:
# - a second segment (`&&`, `||`, `;`, `|`, `&`, newline), a subshell or
#   grouping paren, a redirect or any other heredoc, a `$` expansion, an
#   ANSI-C `$'…'` string;
# - a command substitution or backtick other than the canonical heredoc
#   message `-m "$(cat <<'EOF' … EOF)"` (the strict form below);
# - any word before `git` other than the token, any git verb but `commit`;
# - a commit flag that stages content itself (`-a`/`--all`, `-p`/`--patch`,
#   `--interactive`, `--pathspec-from-file`), a pathspec argument, and any
#   flag outside the recognised set below.
# Probe: the "override: standalone rule" rows.

OVERRIDE_TOKEN = "TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1"
# Global options that consume the FOLLOWING word as their value (`-C dir`,
# `-c k=v`, `--git-dir dir`). The `=`-joined spellings are one word and need
# no entry. An unlisted value-taking option makes its value read as the verb,
# which is not `commit`, so the miss can only refuse, never pass.
GIT_VALUE_GLOBALS = (
    "-c", "-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env",
)
# `git commit` options, taken from `git commit -h` (git 2.50.1). A REQUIRED
# value is taken attached or as the next word. An OPTIONAL value (`-S[<keyid>]`,
# `-u[<mode>]`, `--gpg-sign[=<keyid>]`, `--untracked-files[=<mode>]`) is taken
# attached ONLY: git reads the next word as a PATHSPEC (measured, git 2.50.1:
# `git commit -S f.ts` committed the unstaged f.ts, and `-S ABCD1234` failed
# with "pathspec 'ABCD1234' did not match"), so it stays a pathspec here too.
# Long options are matched by EXACT name because git accepts any unique
# prefix (measured: `--pathspec-from=list.txt` staged the listed file like
# `--pathspec-from-file=`), so an unrecognised spelling is refused rather than
# read as harmless.
COMMIT_SHORT_VALUE = "mFcCt"
COMMIT_SHORT_OPTIONAL = "Su"
COMMIT_SHORT_FLAG = "qvseionz"
COMMIT_SHORT_STAGES = "ap"
COMMIT_LONG_VALUE = (
    "message", "file", "reuse-message", "reedit-message", "fixup", "squash",
    "author", "date", "template", "cleanup", "trailer",
)
COMMIT_LONG_OPTIONAL = ("gpg-sign", "untracked-files")
COMMIT_LONG_FLAG = (
    "quiet", "verbose", "signoff", "edit", "include", "only", "verify",
    "dry-run", "short", "branch", "ahead-behind", "porcelain", "long", "null",
    "amend", "post-rewrite", "reset-author", "status", "pathspec-file-nul",
    "allow-empty", "allow-empty-message",
)
COMMIT_LONG_STAGES = ("all", "patch", "interactive", "pathspec-from-file")
COMMIT_LONG_KNOWN = COMMIT_LONG_VALUE + COMMIT_LONG_OPTIONAL + COMMIT_LONG_FLAG + COMMIT_LONG_STAGES

# The opener of the ONE substitution allowed under the token: `$(cat <<'EOF'`
# with a QUOTED delimiter (an unquoted one expands `$(…)` inside the body)
# and nothing after it on the opener line (`$(cat <<'EOF' && git add x` runs
# the add inside the substitution).
MSG_HEREDOC_OPENER = re.compile(r"\$\(cat[ \t]+<<-?[ \t]*(['\"])(\w+)\1[ \t]*\n")
SUBSTITUTION_CLOSE = re.compile(r"\s*\)")


def _message_heredoc_end(text, opener):
    # The index just past the `)` closing a strict heredoc-message
    # substitution, or None when the shape is anything else. The terminator
    # match is deliberately MORE lenient than bash (surrounding blanks allowed
    # on every form): bash ends the body at the first line that is exactly the
    # delimiter, so this match can only land on that line or an earlier one,
    # and an earlier one leaves bash-body text in the scanned command, which
    # can only refuse (argued from bash's documented terminator rule, not
    # probed against an early-terminator fixture). After the terminator only
    # blanks may precede the `)`,
    # so no command can sit between the body and the close (probe: "override:
    # a command between the heredoc terminator and the close is refused").
    terminator = re.compile(r"^[ \t]*" + re.escape(opener.group(2)) + r"[ \t]*$", re.M)
    found = terminator.search(text, opener.end())
    if found is None:
        return None
    close = SUBSTITUTION_CLOSE.match(text, found.end())
    return None if close is None else close.end()


def _strip_message_heredocs(text):
    # `text` with every strict heredoc-message substitution replaced by `MSG`,
    # scanned with quote state so a `$(cat <<'EOF'` inside a single-quoted
    # region (inert to bash, and able to pair quotes around live text) is never
    # treated as a message. Anything not in the strict shape is left in place
    # and refused downstream as an ordinary substitution.
    # Escapes are approximated: any `\X` outside single quotes passes through
    # as an opaque pair (bash strips the backslash in some double-quote
    # cases). The quote state stays correct either way, and the output is
    # re-parsed by shell_quotes' scanner, so the approximation only decides
    # where a heredoc message may start.
    out = []
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "$" and quote != "'":
            opener = MSG_HEREDOC_OPENER.match(text, i)
            end = _message_heredoc_end(text, opener) if opener is not None else None
            if end is not None:
                out.append("MSG")
                i = end
                continue
        if ch == "\\" and quote != "'" and i + 1 < len(text):
            out.append(text[i : i + 2])
            i += 2
            continue
        if ch in "'\"" and quote in (None, ch):
            quote = ch if quote is None else None
        out.append(ch)
        i += 1
    return "".join(out)


def _commit_args_refusal(args):
    # Why the words after `commit` make the commit set something other than
    # the index, or None when they do not.
    i = 0
    while i < len(args):
        word = args[i]
        i += 1
        if word == "--":
            if i < len(args):
                return f"the pathspec argument `{args[i]}` after `--`"
            continue
        if word.startswith("--"):
            name = word[2:].split("=", 1)[0]
            has_value = "=" in word
            if name in COMMIT_LONG_STAGES:
                return f"`--{name}`, which stages content at commit time"
            if name in COMMIT_LONG_VALUE:
                if not has_value:
                    i += 1
                continue
            if name in COMMIT_LONG_OPTIONAL:
                continue
            negated = name[3:] if name.startswith("no-") else None
            if not has_value and (name in COMMIT_LONG_FLAG or negated in COMMIT_LONG_KNOWN):
                continue
            return f"the unrecognised commit flag `{word}`"
        if word.startswith("-") and len(word) > 1:
            for pos, letter in enumerate(word[1:], start=1):
                if letter in COMMIT_SHORT_STAGES:
                    return f"`-{letter}` (in `{word}`), which stages content at commit time"
                if letter in COMMIT_SHORT_VALUE:
                    # The rest of the word is the value; a bare letter at the
                    # end of the word takes the NEXT word instead.
                    if pos == len(word) - 1:
                        i += 1
                    break
                if letter in COMMIT_SHORT_OPTIONAL:
                    break
                if letter not in COMMIT_SHORT_FLAG:
                    return f"the unrecognised commit flag `{word}`"
            continue
        return f"the pathspec argument `{word}`"
    return None


def _override_verdict(raw):
    # "override" when `raw` is the standalone token commit, else
    # "override-refused:<reason>" for the caller's banner.
    text = _strip_message_heredocs(raw)
    if "$'" in text:
        return "override-refused:an ANSI-C $'...' string"
    if substitution_spans(text):
        return "override-refused:a command substitution or backtick other than the heredoc message"
    flat = strip_quoted(text)
    if flat is None:
        return "override-refused:an unterminated quote"
    flat = flat.strip()
    shape = re.search(r"[;&|\n()`$<>]", flat)
    if shape is not None:
        char = "newline" if shape.group() == "\n" else shape.group()
        return (
            "override-refused:a second command, subshell, redirect or expansion "
            f"(`{char}`)"
        )
    words = flat.split()
    if not words or words[0] != OVERRIDE_TOKEN:
        return "override-refused:a word before the token"
    if len(words) < 2 or words[1].lower() != "git":
        return "override-refused:a command other than git after the token"
    i = 2
    while i < len(words) and words[i].startswith("-"):
        i += 2 if words[i] in GIT_VALUE_GLOBALS else 1
    if i >= len(words) or words[i].lower() != "commit":
        return "override-refused:a git verb other than commit"
    reason = _commit_args_refusal(words[i + 1 :])
    return "override" if reason is None else "override-refused:" + reason


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
        # Same isolation as the header verdict in `_emit`: an exception out of
        # `_override_verdict` would exit the whole heredoc non-zero and the
        # caller's `|| exit 0` would fail the ENTIRE hook open. On the token
        # path that is an unreviewed commit, so degrade to a refusal instead.
        # Not probed: forcing the exception needs a test-only seam in
        # production code, which this guard does not carry.
        try:
            override_verdict = _override_verdict(raw_cmd)
        except Exception:
            override_verdict = (
                "override-refused:an internal parse error (refusing rather than guessing)"
            )
        _emit(override_verdict)

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
        taskopen)
          REASON_TEXT="opens with a task id (TASK-N) — commit subjects must not lead with the task id"
          WHICH_TEXT="task-id-leading-subject (subject opens with TASK-N)"
          ;;
        length)
          REASON_TEXT="is too long: commitlint header-max-length caps the full header at 100 characters"
          WHICH_TEXT="header-max-length ($HDR_LEN > 100)"
          ;;
        case)
          REASON_TEXT="starts with an uppercase letter — commitlint subject-case requires lowercase"
          WHICH_TEXT="subject-case (subject starts with an uppercase letter)"
          ;;
        *)
          REASON_TEXT="fails the commit header shape check"
          WHICH_TEXT="unknown ($HDR_REASON)"
          ;;
      esac
      cat >&2 <<HDRBANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMIT HEADER PRE-CHECK — commit blocked before husky ever runs
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This commit's subject $REASON_TEXT (05-tooling.md § Commit Message
Format; commitlint header-max-length / subject-case).

which: $WHICH_TEXT
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

# "check" = no override (working-tree gate below); "override" = the token
# commit stands alone; "override-refused:<reason>" = token present on any
# other command shape. The branch check still applies to all three, then the
# override block handles the last two. Any other verdict ("ok", no commit
# detected) exits.
case "$GATE_VERDICT" in
  check | override | override-refused:*) : ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$BRANCH" != "develop" ] && [ "$BRANCH" != "main" ]; then
  exit 0
fi

# The gated classifier, shared by both gates: the override path runs it over
# the index, the working-tree check below over the dirty tree. One function,
# so the two gates cannot drift apart.
gate_classify() {
  grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|prisma|sql|sh|yml|yaml|json|toml)$|(^|/)Dockerfile[^/]*$|^\.github/|^\.claude/(rules|skills|hooks)/' \
    | grep -vxF 'backlog/cadence-ledger.json'
}

# --- override, refused: the token on anything but a standalone commit -----
# The python heredoc names the shape it refused; the commit set of such a
# command is not knowable from here, so it fails closed (probe: the
# "override: standalone rule" rows).
case "$GATE_VERDICT" in
  override-refused:*)
    cat >&2 <<'REFBANNER'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEVELOP CODE-COMMIT GUARD — override token present, but the commit set
cannot be verified
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Under TZUROT_ALLOW_DEVELOP_CODE_COMMIT the commit must STAND ALONE —
the token plus `git [globals] commit [flags]` and nothing else — so
that what it commits is exactly the index this guard reads. This
command carries:
REFBANNER
    printf '  %s\n' "${GATE_VERDICT#override-refused:}" >&2
    cat >&2 <<'REFFOOTER'

Fix: run the token commit as its own Bash call, after staging SPECIFIC
files in a separate Bash call (e.g. git add tracker/tasks/task-x.md).
Allowed in the token call: -m/--message, -F/--file, the heredoc message
-m "$(cat <<'EOF' … EOF)", and ordinary flags (--no-verify, --amend,
--fixup=…, -S<keyid> attached, --signoff, --allow-empty, -q).
Refused: any other segment (&&, ||, ;, |, newline), a subshell, any
other substitution or backtick, a redirect, -a/--all, -p/--patch,
--interactive, --pathspec-from-file, and pathspec arguments.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REFFOOTER
    exit 2
    ;;
esac

if [ "$GATE_VERDICT" = "override" ]; then
  # --- override: the standalone commit's set is exactly the index ---------
  # The token unlocks doc-only commits, so the working tree is irrelevant
  # here (an incidentally dirty tree is the documented use); the index is
  # what the commit captures. --no-renames, as in the working-tree check
  # below: a staged gated→non-gated rename rendered as one rename line would
  # check only the NEW path's extension; the decomposed D/A lines check the
  # deleted side too.
  STAGED_GATED=$(git diff --cached --name-only --no-renames 2>/dev/null \
    | gate_classify || true)
  if [ -z "$STAGED_GATED" ]; then
    exit 0
  fi

  # Version-bump exception: the working-tree check below, mirrored exactly —
  # its every-gated-file-is-a-package.json restriction included (probe:
  # "override: a staged version-only edit to a non-manifest gated file
  # blocks") — with the diff source switched to what the commit captures,
  # the STAGED diff (`--cached`), so unstaged noise on the same manifest
  # cannot defeat a genuine bump (probe: "override: staged bump passes with
  # unstaged noise on the same manifest").
  if ! printf '%s\n' "$STAGED_GATED" | grep -vE '(^|/)package\.json$' >/dev/null; then
    VERSION_ONLY=1
    while IFS= read -r f; do
      if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        VERSION_ONLY=0; break   # untracked/new manifest is not a bump shape
      fi
      # ([^+-]|$): a bare +/- (added/removed EMPTY line) is still a change.
      CHANGED=$(git diff --cached -U0 -- "$f" 2>/dev/null | grep -E '^[+-]([^+-]|$)' || true)
      if [ -z "$CHANGED" ] \
        || printf '%s\n' "$CHANGED" | grep -vE '^[+-][[:space:]]*"version":' >/dev/null; then
        VERSION_ONLY=0; break
      fi
    done <<< "$STAGED_GATED"
    if [ "$VERSION_ONLY" = "1" ]; then
      exit 0
    fi
  fi

  GATED_COUNT=$(printf '%s\n' "$STAGED_GATED" | wc -l)
  cat >&2 <<'OVRBANNER'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEVELOP CODE-COMMIT GUARD — override token present, but review-gated
files are in the commit set
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TZUROT_ALLOW_DEVELOP_CODE_COMMIT unlocks DOC-ONLY commits on
develop/main; it does not waive the review gate. Gated files are
staged in the index this commit would capture:

Gated files (first 10):
OVRBANNER
  printf '%s\n' "$STAGED_GATED" | head -10 >&2
  if [ "$GATED_COUNT" -gt 10 ]; then
    printf '  …and %d more\n' "$((GATED_COUNT - 10))" >&2
  fi
  cat >&2 <<'OVRFOOTER'

Fix: unstage the gated files (git restore --staged <path>) and stage
ONLY the doc files for this commit, or move the code to a branch —
git checkout -b <type>/<name> — and commit there. Either way, as its
OWN Bash call before the token commit.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVRFOOTER
  exit 2
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
# The one exemption is backlog/cadence-ledger.json, a BOARD file that
# 00-critical.md § Direct doc commits lists as committable to develop without
# a PR. It is dropped by EXACT repo-relative path (`grep -vxF`), never by
# basename or directory: every other *.json — a cadence-ledger.json anywhere
# else included — stays gated.
GATED_FILES=$(git status --porcelain -uall --no-renames 2>/dev/null \
  | cut -c4- \
  | gate_classify \
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

Remedy: issue the branch switch as its OWN Bash call, then commit in the
next call. This gate evaluates the branch BEFORE your && chain runs, and a
blocked PreToolUse call executes NONE of its chain — an earlier `git add`
in the same chain did not run either.

Doc-only commit with an incidentally dirty tree? Stage ONLY the doc
files in one Bash call, then run the commit ALONE in the next, prefixed
with TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 (assignment position).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOOTER
exit 2
