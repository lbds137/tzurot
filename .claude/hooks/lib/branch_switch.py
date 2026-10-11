"""What a command's LEADING segment changes before its `git commit` runs.

A PreToolUse hook runs before the command, so a guard that reads the live
branch or the live checkout judges the state the command STARTS in. Two
leading shapes change that state before a later commit in the same `&&` chain
runs, and a guard that ignores them blocks a commit that lands somewhere else:

    git switch -c feat/x && git add a.ts && git commit -m y
        commits on feat/x, not on the branch checked out now
    git -C /other/repo commit -m x
    cd /other/repo && git commit -m x
        commit in another checkout entirely

`switch_target` names the branch a leading switch moves to, when nothing else
in the command can move the branch or the checkout; `commit_target_dir`
names the directory every commit in the command runs in, when that is provably
one absolute directory. Both return None for anything they cannot read with
certainty, and None means "judge the live state", which is the behaviour the
guards had before this module existed. So a parse gap can only keep a block,
never open one.

WHY ONLY A PURE `&&` CHAIN
--------------------------
`a && b` runs b only when a succeeded, so after `git switch X && …` the rest of
the chain runs on X or not at all. `a; b` runs b even when a FAILED (a dirty
tree that conflicts, a name that already exists for `-c`), so the commit can
land on the original branch; `||`, `|` and `&` give no ordering guarantee
either. So EVERY join in the command must be `&&` — a `;` anywhere, even
after the commit, lets a second commit run elsewhere.

And the switch only holds until something moves the branch or the directory
again: `git switch -c x && git switch develop && git commit` commits on
develop, and `git switch -c x && git -C /other commit` commits in a checkout
the switch never touched. A blocklist of moving verbs cannot be complete (a
git alias such as `git co develop`, a shell function, `make`), so the rest of
the chain is read against an ALLOWLIST instead: every segment after the
leading switch must be `git <subcommand>` with no global flag at all and a
subcommand in `_INERT_GIT_SUBCOMMANDS` (add, commit, status, diff, log,
show), no `log`/`diff`/`show` segment may carry `--output` (it writes a file
of the caller's choosing), and no word of any later segment may have a
`.git` path component, compared without case (`.git/HEAD`, `./.git/x`,
`x/.GIT/y`: a write there rewrites HEAD or a ref directly). The joins must
all be `&&`; a numeric fd redirect (`2>&1`, `>&2`) is not read as a `&`, but
a pipe is still a non-`&&` join. On top of that, no substitution other than
the canonical `"$(cat <<'EOF' … EOF)"` message, no heredoc with an UNQUOTED
delimiter (`<<EOF`, `<<-EOF`: bash expands `$(…)` and backticks in its body
before the commit runs, and the body is stripped before the other checks
see it — a heredoc must use a quoted delimiter, `<<'EOF'` or `<<"EOF"`), no
`bash -c`/`eval` wrapper, and no GIT_DIR-style environment variable.
Everything else keeps the live-branch evaluation.

WHY PLAIN `git checkout <name>` IS NOT READ
-------------------------------------------
`git checkout <word>` switches branches when <word> is a branch and restores
files when it is a path, and the hook cannot tell which without the very ref
lookup it would have to trust. `git switch` and `checkout -b|-B` are
unambiguous.

CONSUMERS
---------
    .claude/hooks/develop-code-commit-guard.sh   (both functions)
    .claude/hooks/board-commit-branch-gate.sh    (switch_target only)

Run as a script it reads the command from GUARD_CMD and prints two lines: the
switch target, then the commit directory, each empty when None. Pinned by the
"switch:" and "cross-repo:" rows in both guards' .probe.sh files.

The quote scanning is the shared single-scan `strip_quoted_indexed` in
shell_quotes.py, imported rather than copied (that module's docstring has the
measured reason two copies of quote logic are a bypass).
"""

import os
import re
import sys

from shell_quotes import (
    QUOTED_SPAN,
    resolve_placeholders,
    strip_heredoc_bodies,
    strip_quoted_indexed,
    substitution_spans_matching,
    wrapped_command_strings,
)

# Characters that end the first command in the quote-stripped view. `&` covers
# both `&&` (checked for explicitly below) and a background `&`; `(`/`)` a
# subshell or grouping; `<`/`>` a redirect.
_FIRST_SEGMENT_END = re.compile(r"[;&|\n()<>]")

# A first segment carrying any of these is not read: `$` and a backtick are
# expansions whose value is unknown here, `{`/`}` brace expansion or grouping,
# `#` a comment that may swallow the `&&` itself.
_UNREADABLE = re.compile(r"[$`{}#]")

# After every `&&` is blanked out, any of these left in the REST of the
# quote-stripped view means a join with no success ordering (`;`, `||`, `|`,
# `&`, a newline), a subshell or group, or a substitution — and the switch
# target is not trusted.
_NON_AND_SEPARATOR = re.compile(r"[;&|\n\r()`{}]")

# A numeric file-descriptor redirect, `N>&M` or `>&M` (`2>&1`, `>&2`): its `&`
# duplicates a descriptor rather than backgrounding the command, so it is
# blanked before the separator check. Digits only on both sides of `>&` —
# `>&file`, `&>file` and a bare `&` still read as a separator, and a pipe is
# never neutralised.
_FD_REDIRECT = re.compile(r"\d*>&\d+")

# The only segments a trusted chain may carry after the leading switch:
# `git <subcommand> …` with the subcommand as the SECOND word (no global flag,
# no assignment prefix, no wrapper such as `command`/`env`) and one of these
# subcommands, none of which can move HEAD or the directory (assuming trusted
# repository config and hooks: diff.external, textconv, core.fsmonitor and
# commit hooks can run commands and are not modelled; not verified). Anything else —
# a git alias (`git co`), `cd`, `make`, `pnpm`, a function, `$CMD` — voids the
# target, because what it runs cannot be known from the text. `mv` and `rm`
# are absent: they write paths of the caller's choosing, and `git mv -f h.txt
# .git/HEAD` rewrites HEAD (git 2.50.1 exits 0 despite "invalid path").
_INERT_GIT_SUBCOMMANDS = frozenset(("add", "commit", "status", "diff", "log", "show"))

# What separates the path steps of a resolved word for the `.git` component
# check: `/`, plus `=` (an `--option=<path>` value) and `<`/`>` (a redirect
# target written against its operator, `>.git/config`).
_PATH_STEP = re.compile(r"[/=<>]")

# Git environment variables that relocate the repository, work tree or index
# for every git call that follows. A mention ANYWHERE in the raw text (an
# `export`, a prefix assignment, even a quoted one) voids both reads.
_GIT_ENV = re.compile(r"GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR")

# The one command substitution a trusted chain may carry: the canonical
# message body `"$(cat <<'EOF' … EOF)"`, which after heredoc and quote
# stripping is a bare `cat <<MARKER`.
_CANONICAL_CAT = re.compile(r"\s*cat\s+<<-?\s*\w+\s*\Z")

# A heredoc opener (`<<WORD` / `<<-WORD`, not a here-string `<<<`) and the
# first character of its delimiter word. Bash expands `$(…)`, backticks and
# parameters in the body unless that word is quoted, and the body is stripped
# before every other check here, so an UNQUOTED delimiter hides a substitution
# that runs before the commit. A delimiter opening with `'`, `"` or `\` is
# quoted; anything else (including a partly-quoted `E"OF"`, which bash would
# also treat as quoted) counts as unquoted, the direction that keeps the live
# branch. Read on the RAW text: the canonical message's heredoc sits inside a
# double-quoted `$(…)`, invisible in the quote-stripped view.
_HEREDOC_DELIMITER = re.compile(r"(?<!<)<<(?!<)-?[ \t]*(\S)")
_QUOTED_DELIMITER_START = ("'", '"', "\\")

# Options of the allowlisted read-only subcommands that write a file of the
# caller's choosing (a ref, the HEAD file), which makes the segment not inert.
# git accepts no abbreviation of `--output` for log/diff/show (probed: git
# 2.50.1 rejects `--outp=`/`--out=` as an unrecognized argument).
_WRITING_OPTION = re.compile(r"--output(?:=|\Z)")
_OUTPUT_SUBCOMMANDS = frozenset(("log", "diff", "show"))

_SWITCH_CREATE = ("-c", "-C", "--create", "--force-create")
_CHECKOUT_CREATE = ("-b", "-B")

# The subset of git's ref-name rules (git-check-ref-format) a typed branch name
# can break, plus `$` and a backtick, whose presence after quote removal means
# a literal the guard would rather not trust. A rejected name returns None,
# i.e. the live branch is judged, so this list only has to be conservative.
_BAD_REF = re.compile(r"[\x00-\x20\x7f~^:?*\[\\$`]|\.\.|@\{|//|^[-/.]|[/.]$|\.lock$|^@$")


def _view(text):
    """`(view, values)` from the shared indexed strip, or None."""
    return strip_quoted_indexed(text)


def _words(view, values, start, end):
    """The resolved bash words of `view[start:end]`."""
    out = []
    for tok in re.finditer(r"\S+", view[start:end]):
        pos = start + tok.start()
        resolved, _ = resolve_placeholders(tok.group(), values, view.count(QUOTED_SPAN, 0, pos))
        out.append(resolved)
    return out


def _branch_name(word):
    if not word or QUOTED_SPAN in word or _BAD_REF.search(word):
        return None
    return word


def _first_segment(view):
    """`(start, end)` of the first command when it is joined to the next one by
    `&&`, else None."""
    start = len(view) - len(view.lstrip())
    stop = _FIRST_SEGMENT_END.search(view, start)
    if stop is None or view[stop.start() : stop.start() + 2] != "&&":
        return None
    if _UNREADABLE.search(view, start, stop.start()):
        return None
    return start, stop.start()


def _relocating_env(text):
    """True when the raw command names a git environment variable that moves
    the repository, work tree or index for every later git call."""
    return _GIT_ENV.search(text) is not None


def _unquoted_heredoc(text):
    """True when the raw command opens any heredoc whose delimiter is not
    quoted, so bash expands substitutions in its body."""
    return any(m.group(1) not in _QUOTED_DELIMITER_START for m in _HEREDOC_DELIMITER.finditer(text))


def _names_git_dir(word):
    """True when a resolved word has a `.git` path component (compared without
    case: a case-insensitive file system resolves `.GIT` to the same
    directory). A path inside the repository directory can rewrite HEAD or a
    ref directly, whatever the verb that writes it."""
    return any(step.lower() == ".git" for step in _PATH_STEP.split(word))


def _rest_moves(view, values, start):
    """True unless `view[start:]` is provably unable to move the branch or the
    directory (assuming trusted repository config and hooks: diff.external,
    textconv, core.fsmonitor and commit hooks can run commands and are not
    modelled; not verified): the whole remainder is `&&`-joined (a numeric fd redirect such
    as `2>&1` is not a join), every segment is `git <subcommand> …` with the
    subcommand (the second word, so no global flag) in
    `_INERT_GIT_SUBCOMMANDS`, no word of any segment has a `.git` path
    component (`.git/HEAD`, `./.git/x`, `x/.GIT/y`), and no `log`/`diff`/
    `show` segment carries `--output` (it writes an arbitrary file). The
    subcommand is read UNRESOLVED from the quote-stripped view, so a quoted
    `"git"` is a placeholder, not `git`; the `.git` and `--output` checks read
    the RESOLVED words, so a quoted `".git/HEAD"` or `"--output=…"` is still
    seen."""
    # Blanked to the same length, so offsets into `view` still line up.
    rest = _FD_REDIRECT.sub(lambda m: " " * len(m.group()), view[start:])
    if _NON_AND_SEPARATOR.search(rest.replace("&&", " ")):
        return True
    pos = start
    for segment in rest.split("&&"):
        seg_start, pos = pos, pos + len(segment) + 2
        words = segment.split()
        if len(words) < 2 or words[0] != "git" or words[1] not in _INERT_GIT_SUBCOMMANDS:
            return True
        resolved = _words(view, values, seg_start, seg_start + len(segment))
        if any(_names_git_dir(w) for w in resolved):
            return True
        if words[1] in _OUTPUT_SUBCOMMANDS and any(_WRITING_OPTION.match(w) for w in resolved):
            return True
    return False


def switch_target(text):
    """The branch a leading `git switch …` / `git checkout -b|-B …` moves to,
    when nothing else in the command can move the branch or the checkout
    (same trusted-config assumption as `_rest_moves`); else None.

    Read: `git switch <name>`, `git switch -c|-C|--create|--force-create
    <name> [start]`, `git checkout -b|-B <name> [start]`. Not read (None): a
    global flag before the subcommand (`git -C dir switch …` switches ANOTHER
    checkout), any other flag, plain `git checkout <name>`, a leading
    assignment, and every command that is not a pure `&&` chain.

    The target is only true for the WHOLE command when nothing after the
    switch undoes it, so the rest of the chain must be provably inert (each
    of these returns None): any separator other than `&&` anywhere (`;`,
    `||`, `|`, `&`, a newline, a subshell or group, a backtick or `$(`; the
    `&` of a numeric fd redirect, `2>&1` or `>&2`, is not a separator); a
    command substitution other than the canonical `cat <<MARKER` message, or
    a `bash -c`/`eval` wrapper, anywhere, quoted or not; any heredoc whose
    delimiter is unquoted (`<<EOF`, `<<-EOF`), whatever its body, because
    bash expands substitutions in that body before the commit runs (a
    delimiter opening with `'`, `"` or `\\` is quoted; a here-string `<<<` is
    not a heredoc); any later segment that is not `git <subcommand>` with no
    global flag and a subcommand in the allowlist `_INERT_GIT_SUBCOMMANDS`
    (add, commit, status, diff, log, show) — so a git alias, `cd`, `make`,
    `env`, `command`, a function, `$CMD`, `git mv` and `git rm` all void the
    target; a `log`/`diff`/`show` segment carrying `--output` or
    `--output=`; any later word with a `.git` path component, compared
    without case (`.git/HEAD`, `./.git/x`, `x/.GIT/y`, a redirect target
    `>.git/config`, an `--opt=.git/x` value); and a
    GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR mention
    anywhere in the raw text.
    """
    if _relocating_env(text):
        return None
    # Any substitution can run arbitrary commands BEFORE the commit (it is
    # expanded while the commit's arguments are built), and a quoted one is
    # invisible in the stripped view, so it is checked on the raw text. The
    # one exception is the repo's canonical message shape,
    # `-m "$(cat <<'EOF' … EOF)"`, whose span is a bare `cat <<MARKER`.
    if substitution_spans_matching(text, lambda s: _CANONICAL_CAT.match(s) is None):
        return None
    if wrapped_command_strings(text):
        return None
    # The heredoc strip below removes every body before any check sees it, and
    # the substitution scan above runs on the stripped text too, so a
    # substitution in an UNQUOTED-delimiter body (which bash expands before
    # the commit runs) is otherwise invisible. Refuse any such heredoc.
    if _unquoted_heredoc(text):
        return None
    scanned = _view(strip_heredoc_bodies(text))
    if scanned is None:
        return None
    view, values = scanned
    # A heredoc strip keeps the newline that ends the opener's line; a
    # trailing one separates nothing.
    view = view.rstrip()
    bounds = _first_segment(view)
    if bounds is None:
        return None
    if _rest_moves(view, values, bounds[1] + 2):
        return None
    words = _words(view, values, *bounds)
    if len(words) < 3 or words[0] != "git":
        return None
    verb, rest = words[1], words[2:]
    creates = (verb == "switch" and rest[0] in _SWITCH_CREATE) or (verb == "checkout" and rest[0] in _CHECKOUT_CREATE)
    if creates:
        if len(rest) not in (2, 3):
            return None
        if len(rest) == 3 and (not rest[2] or rest[2].startswith("-")):
            return None
        return _branch_name(rest[1])
    if verb == "switch" and len(rest) == 1:
        return _branch_name(rest[0])
    return None


# Global options `git` accepts before the subcommand that a commit-dir read can
# step over: `-c` consumes the next word, the rest take none. `--git-dir` and
# `--work-tree` are deliberately absent — they relocate the repository in ways
# a toplevel comparison does not model — so meeting one returns None.
_GIT_SKIP_VALUE = ("-c",)
_GIT_SKIP_FLAG = (
    "--no-pager",
    "-P",
    "--paginate",
    "-p",
    "--no-optional-locks",
    "--literal-pathspecs",
    "--no-replace-objects",
)

_SEGMENT_SPLIT = re.compile(r"&&|\|\||[;&|\n()]")
_COMMIT_WORD = re.compile(r"(?i)(?<![\w-])commit(?![\w-])")


def _has_parent_step(path):
    """True when `path` has a `..` component. `cd` and `git -C` resolve one
    PHYSICALLY — through a symlink it climbs out of the link's TARGET, not the
    directory the text names — while `os.path.normpath` drops it lexically, so
    `/other/l/..` (with `l` a link into this repo) would read as `/other`.
    No such path is read; there is no realpath resolution."""
    return ".." in path.split("/")


def _absolute_dir(word):
    # Absolute only: a relative dir resolves against the SHELL's cwd, which the
    # hook does not reliably know. `~`, expansions and globs are refused by the
    # same rule (none of them start with `/`, or they carry `$`/`*`).
    if not word.startswith("/") or QUOTED_SPAN in word or _has_parent_step(word):
        return None
    if re.search(r"[\x00-\x1f$`*?\[]", word):
        return None
    return word


def _commit_dir(words, base):
    """The directory a `git [globals] commit …` segment runs in, or None."""
    if not words or words[0] != "git":
        return None
    here = base
    i = 1
    while i < len(words) and words[i].startswith("-"):
        flag = words[i]
        if flag == "-C":
            if i + 1 >= len(words):
                return None
            step = words[i + 1]
            if step.startswith("/"):
                here = _absolute_dir(step)
            elif here is not None and not re.search(r"[\x00-\x1f$`*?\[~]", step) and not _has_parent_step(step):
                here = os.path.join(here, step)
            else:
                return None
            if here is None:
                return None
            i += 2
        elif flag in _GIT_SKIP_VALUE:
            i += 2
        elif flag in _GIT_SKIP_FLAG:
            i += 1
        else:
            return None
    if i >= len(words) or words[i] != "commit":
        return None
    return here


def commit_target_dir(text):
    """The one absolute directory every `git commit` in `text` runs in, else
    None.

    The directory comes from a leading `cd <abs dir> &&` and/or a `git -C
    <dir>` global flag on each commit. None whenever any commit could run
    anywhere else, or could not be located at all: a `commit` word in a
    segment that is not a plain `git [globals] commit`, a commit inside a
    command substitution or a `bash -c`/`eval` wrapper, any `cd`/`pushd`/
    `popd` other than the leading one, two commits in different directories,
    a relative or unexpandable directory, a directory (the leading `cd` one,
    or any `-C` step, absolute or joined) with a `..` component — `cd` and
    `git -C` resolve it physically through a symlink, `normpath` only
    lexically — and a GIT_DIR / GIT_WORK_TREE /
    GIT_INDEX_FILE / GIT_COMMON_DIR mention anywhere in the raw text (an
    exported one relocates the commit whatever `-C` says).
    """
    if _relocating_env(text):
        return None
    if substitution_spans_matching(text, lambda s: _COMMIT_WORD.search(s) is not None):
        return None
    if wrapped_command_strings(text):
        return None
    scanned = _view(strip_heredoc_bodies(text))
    if scanned is None:
        return None
    view, values = scanned
    if re.search(r"[`{}]", view):
        return None

    base = None
    rest_start = 0
    bounds = _first_segment(view)
    if bounds is not None:
        first = _words(view, values, *bounds)
        if len(first) == 2 and first[0] == "cd":
            base = _absolute_dir(first[1])
            if base is None:
                return None
            rest_start = bounds[1] + 2

    found = set()
    pos = rest_start
    for sep in [*_SEGMENT_SPLIT.finditer(view, rest_start), None]:
        end = sep.start() if sep is not None else len(view)
        words = _words(view, values, pos, end)
        pos = sep.end() if sep is not None else len(view)
        if not words:
            continue
        if words[0] in ("cd", "pushd", "popd"):
            return None
        if not any(w.lower() == "commit" for w in words):
            continue
        where = _commit_dir(words, base)
        if where is None:
            return None
        found.add(os.path.normpath(where))
    if len(found) != 1:
        return None
    return found.pop()


if __name__ == "__main__":
    command = os.environ.get("GUARD_CMD", "")
    for fn in (switch_target, commit_target_dir):
        try:
            value = fn(command)
        except Exception:
            # Fail toward the live-state evaluation, the guards' pre-existing
            # behaviour, rather than toward any reading of the command.
            value = None
        print(value or "")
    sys.exit(0)
