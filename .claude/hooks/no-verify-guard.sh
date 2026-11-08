#!/bin/bash
# PreToolUse hook (matcher: Bash) — blocks a `git commit` / `git push` that
# skips the repo's git hooks.
#
# The hooks (lint-staged prettier/eslint, commitlint, pre-push build/lint/test)
# are the gate CI would otherwise catch a round later; a commit made with the
# hooks skipped surfaces its formatting or lint failure only after a CI cycle.
#
# Four hook-skip shapes block (each judged per invocation, in that one
# invocation's own argument span, never the whole command):
#   1. commit: `--no-verify`, `-n`, or a short-flag bundle containing `n` with
#      no arg-taking letter (m F c C t u S, per ARG_TAKING) before it (`-nm`, `-an` block; `-mn` is
#      the message "n" and passes).
#   2. push: `--no-verify` only. `-n` on push is `--dry-run` and passes.
#   3. `core.hooksPath` among the git global flags (`git -c core.hooksPath=…`).
#   4. `HUSKY=0` as an env assignment prefixing that invocation.
#
# Override, per invocation (an owner-approved exception):
#   TZUROT_ALLOW_NO_VERIFY=1 git commit ...
# The token must prefix the SAME invocation it waives; one prefixed invocation
# never waives a sibling in the same chain.
#
# Scan: each level is `strip_heredoc_bodies` then `strip_quoted_indexed`
# (lib/shell_quotes.py), recursing through `wrapped_command_strings` (`bash -c`
# / `sh -c` / `eval`), so a commit MESSAGE mentioning `--no-verify` or `-n` is
# inert and a wrapped commit is still seen. The indexed form is used instead of
# `executed_segments` so quoted values in the git global-flag span can be
# resolved (`git -c 'core.hooksPath=…' commit`). `(`, `)`, `{`, `}` end an
# invocation like `;`, and args are tokenized on whitespace, parens and
# redirect angle brackets, so `(git push --no-verify)` and
# `--no-verify>/dev/null` are seen. Redirect forms (`2>&1`, `&>`), comments,
# a bare `--` (pathspecs follow), brace expansions (`{a,b}`) and `${…}`,
# `@{…}`, `$(…)`, backtick spans are blanked or cut before splitting so they
# neither end nor extend an invocation; substitution bodies are scanned as
# strings of their own.
#
# A waived invocation prints `no-verify-guard: override used (git <kind>)` to
# stderr and exits 0. A quoted value (`TZUROT_ALLOW_NO_VERIFY="1"`,
# `HUSKY="0"`) counts, since bash assigns the same value; a wholly quoted
# `'HUSKY=0'` is a command word, not an assignment, and does not.
#
# The override prefixes the invocation it waives, including an inner one:
# `TZUROT_ALLOW_NO_VERIFY=1 bash -c 'git commit -n -m x'` still blocks, while
# `HUSKY=0 bash -c 'git commit -m x'` passes (named gap below).
#
# Fail-open on every internal error (jq or python missing, lib import failure,
# an unterminated quote that makes the strip give up): a broken gate must not
# block real work.
#
# The probe scripts' own fixture commits carry `--no-verify` inside script
# files, which this hook never sees (it reads only the typed command), so no
# temp-repo exemption is needed.
#
# KNOWN GAPS (habitual shapes only; exotic spellings are not written by
# accident):
#   - `export HUSKY=0` earlier in the chain (only an assignment prefixing the
#     invocation itself is seen).
#   - git's unambiguous long-option abbreviations (`--no-verif`).
#   - a later `--verify` re-enabling hooks is still blocked (over-arm).
#   - command text built at runtime (`bash -c "$CMD"`).
#   - `git config core.hooksPath …` (persistent config, not an invocation
#     flag) and the `GIT_CONFIG_COUNT` / `GIT_CONFIG_PARAMETERS` env forms.
#   - `HUSKY=0 bash -c '…'` (the assignment prefixes the wrapper, not the
#     inner invocation).
#   - quoted command arguments to non-shell programs are not scanned:
#     `git rebase -x 'git commit -n'`, `git submodule foreach 'git push
#     --no-verify'`.
#   - OVER-arm: a separate-arg value that looks like the flag
#     (`git commit -m -n`, `-F -n`, `-m -n5`) blocks.
#   - a quoted flag passes: `git commit "-n"`, `git commit '--no-verify'`.
#   - OVER-arm: an unquoted `echo git commit --no-verify` blocks (the text
#     is indistinguishable from an invocation once quotes are stripped).
#   - process substitution ends the argument span: `git commit -F <(echo x)
#     -n` passes (its `(` reads as a separator).
#   - git aliases are not resolved: `git ci -n` passes.
#   - a flag built by brace expansion passes: `git commit {--no-,}verify`,
#     `git commit -m x {-n,}`.
#
# Fixture check: run .claude/hooks/no-verify-guard.probe.sh after ANY edit to
# this hook.

set -uo pipefail

INPUT=$(cat 2>/dev/null) || exit 0
COMMAND=$(printf '%s' "$INPUT" | jq -r '
  select(.tool_name == "Bash") | .tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$COMMAND" ] && exit 0

# Cheap raw short-circuit: no `git … commit` / `git … push` anywhere
# (case-insensitive, matching the detection patterns below). `HUSKY=0` alone
# never blocks.
shopt -s nocasematch
case "$COMMAND" in
  *git*commit* | *git*push*) ;;
  *) exit 0 ;;
esac
shopt -u nocasematch

HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib"
SEEN=$(GUARD_CMD="$COMMAND" HOOK_LIB="$HOOK_LIB" PYTHONDONTWRITEBYTECODE=1 python3 << 'PYEOF'
import os
import re
import sys

sys.path.insert(0, os.environ["HOOK_LIB"])
from shell_quotes import (
    MAX_WRAPPER_DEPTH,
    QUOTED_SPAN,
    resolve_placeholders,
    substitution_spans,
    strip_heredoc_bodies,
    strip_quoted,
    strip_quoted_indexed,
    wrapped_command_strings,
)
from git_commit import GIT_COMMIT_RE, GIT_PUSH_RE

cmd = os.environ.get("GUARD_CMD", "")

HOOKSPATH_RE = re.compile(r"(?i)core\.hooksPath")
# Short flags that take an attached argument (`-uno` is untracked-files mode,
# `-Sn` a signing key id).
ARG_TAKING = "mFcCtuS"
# Redirect forms whose `&`/`|` is not a command separator.
REDIRECT_RE = re.compile(r"\d*>&\d*|\d*<&\d*|&>>?|>\|")
# A `#` at segment start or after whitespace comments out the rest of the line.
COMMENT_RE = re.compile(r"(?:^|(?<=\s))#[^\n]*")


def blank(m):
    """Same-length blanking so every index into the view stays valid."""
    return " " * len(m.group())


cmd = strip_heredoc_bodies(cmd)
# A backslash-newline is a line continuation, not a command separator.
cmd = cmd.replace("\\\n", "  ")
# Fail-open: an unterminated quote makes the strip give up.
if strip_quoted(cmd) is None:
    sys.exit(0)


def commit_skips(tokens):
    for tok in tokens:
        if tok == "--no-verify":
            return "--no-verify"
        # The leading letter run of a single-dash bundle: an attached non-letter
        # value (`-nm"x"`, `-nFmsg.txt`) does not hide an `n` that comes first.
        bundle = re.match(r"-([A-Za-z]+)", tok)
        if bundle:
            for ch in bundle.group(1):
                if ch in ARG_TAKING:
                    break
                if ch == "n":
                    return "-n"
    return None


SEPARATOR_RE = re.compile(r"[;&|\n(){}]")
# Brace expansion (`src/{a,b}.ts`): a `{` with no whitespace before its `}` is
# never a brace group, so it must not end the invocation.
BRACE_EXPANSION_RE = re.compile(r"\{[^\s{};&|()]+\}")
TOKEN_SPLIT_RE = re.compile(r"[\s()<>]+")


def indexed_views(text, depth=0):
    """Yield (view, values) for `text` and each `bash -c`/`sh -c`/`eval` inner
    string: quoted spans become QUOTED_SPAN placeholders that `values` resolves."""
    text = strip_heredoc_bodies(text)
    scanned = strip_quoted_indexed(text)
    # Fail-open: a view whose strip gives up (unterminated quote) is skipped,
    # never scanned as raw text.
    if scanned is not None:
        yield scanned
    if depth < MAX_WRAPPER_DEPTH:
        for inner in wrapped_command_strings(text):
            yield from indexed_views(inner, depth + 1)
        # Substitution bodies run as commands; scan each as its own string.
        for inner in substitution_spans(text):
            yield from indexed_views(inner, depth + 1)


def blank_substitutions(view):
    """Same-length blank `${…}`, `@{…}`, backtick and `$(…)` spans so their
    parens and braces are not read as separators (`HEAD@{1}`, `${BRANCH}`,
    `$(cat msg)`). Their bodies are scanned separately by `indexed_views`."""
    out = list(view)
    i, n = 0, len(view)
    while i < n:
        two = view[i : i + 2]
        end = None
        if two in ("${", "@{"):
            close = view.find("}", i + 2)
            end = close + 1 if close != -1 else None
        elif view[i] == "`":
            close = view.find("`", i + 1)
            end = close + 1 if close != -1 else None
        elif two == "$(":
            depth, j = 0, i + 1
            while j < n:
                if view[j] == "(":
                    depth += 1
                elif view[j] == ")":
                    depth -= 1
                    if depth == 0:
                        end = j + 1
                        break
                j += 1
        if end is None:
            i += 1
            continue
        for k in range(i, end):
            out[k] = " "
        i = end
    return "".join(out)


def prefix_assignments(orig_view, values, pstart, ptext):
    """(override_present, husky_off) for the assignment words prefixing ONE
    invocation. Every word anywhere in the prefix text before the invocation
    is considered (so `env HUSKY=0 git commit` counts), not only a leading
    word. A word counts only when it BEGINS with the literal name (a wholly
    quoted `'HUSKY=0'` is a command word, not an assignment) and its quoted
    value resolves to the exact value (`HUSKY="0"` counts). Accepted
    over-reach: `echo TZUROT_ALLOW_NO_VERIFY=1 git commit -n` is treated as
    overridden, which is harmless because the commit there is echo text."""
    allowed = husky = False
    for tok in re.finditer(r"\S+", ptext):
        raw = tok.group()
        resolved, _ = resolve_placeholders(
            raw, values, orig_view.count(QUOTED_SPAN, 0, pstart + tok.start())
        )
        if raw.startswith("TZUROT_ALLOW_NO_VERIFY=") and resolved == "TZUROT_ALLOW_NO_VERIFY=1":
            allowed = True
        if raw.startswith("HUSKY=") and resolved == "HUSKY=0":
            husky = True
    return allowed, husky


found = []
for orig_view, values in indexed_views(cmd):
    view = blank_substitutions(COMMENT_RE.sub(blank, REDIRECT_RE.sub(blank, orig_view)))
    # Filled with `_`, not spaces, so `{a,b}-notes.md` stays one word.
    view = BRACE_EXPANSION_RE.sub(lambda m: "_" * len(m.group()), view)

    def segment_after(end):
        """Text from `end` to the next command separator: one invocation's args."""
        seg = view[end:]
        stop = SEPARATOR_RE.search(seg)
        return seg[: stop.start()] if stop is not None else seg

    def prefix_before(start):
        """Text from the previous separator (or start) to `start`."""
        seg = view[:start]
        last = None
        for sep in SEPARATOR_RE.finditer(seg):
            last = sep
        begin = last.end() if last is not None else 0
        return begin, seg[begin:]

    for kind, regex in (("commit", GIT_COMMIT_RE), ("push", GIT_PUSH_RE)):
        for m in regex.finditer(view):
            pstart, ptext = prefix_before(m.start())
            allowed, husky = prefix_assignments(orig_view, values, pstart, ptext)
            tokens = [t for t in TOKEN_SPLIT_RE.split(segment_after(m.end())) if t]
            # A bare `--` ends options; pathspecs follow.
            if "--" in tokens:
                tokens = tokens[: tokens.index("--")]
            reasons = []
            if kind == "commit":
                flag = commit_skips(tokens)
                if flag:
                    reasons.append(flag)
            elif "--no-verify" in tokens:
                reasons.append("--no-verify")
            # Resolve quoted values inside the global-flag span only
            # (`git -c 'core.hooksPath=…' commit`).
            flags_text, _ = resolve_placeholders(
                m.group(), values, orig_view.count(QUOTED_SPAN, 0, m.start())
            )
            if HOOKSPATH_RE.search(flags_text):
                reasons.append("core.hooksPath")
            if husky:
                reasons.append("HUSKY=0")
            if reasons and allowed:
                print("no-verify-guard: override used (git %s)" % kind, file=sys.stderr)
            elif reasons:
                found.append("git %s: %s" % (kind, ", ".join(reasons)))

for line in found:
    print(line)
PYEOF
) || exit 0

[ -z "$SEEN" ] && exit 0

cat >&2 <<BANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NO-VERIFY GUARD — git hooks skipped
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Seen:
$(printf '%s\n' "$SEEN" | sed 's/^/  /')

The git hooks (lint-staged, commitlint, pre-push tests) are the gate CI
would otherwise catch a round later. Fix the failure the hook reports
instead of skipping it.

Ask the owner first. Only with their approval, prefix that one invocation:
TZUROT_ALLOW_NO_VERIFY=1 git commit ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANNER
exit 2
