"""What a command changes before its `git commit` runs.

A PreToolUse hook runs before the command, so a guard that reads the live
branch or the live checkout judges the state the command STARTS in. Two
shapes change that state before a later commit in the same `&&` chain
runs, and a guard that ignores them blocks a commit that lands somewhere else:

    git switch -c feat/x && git add a.ts && git commit -m y
        commits on feat/x, not on the branch checked out now
    git -C /other/repo commit -m x
    env -C /other/repo git commit -m x
    cd /other/repo && git commit -m x
        commit in another checkout entirely

`switch_target` names the branch a leading switch moves to, when nothing else
in the command can move the branch or the checkout; `commit_target_dir`
names the directory every commit in the command runs in, when that is provably
one directory: an absolute one, or a plain relative one reached from the
starting checkout (the caller resolves it against its own working directory).
Both return None for anything they cannot read with
certainty, and None means "judge the live state", the guards' baseline
evaluation. A parse gap falls back to that evaluation — which keeps a block
on develop, but on a feature checkout can pass a commit that lands elsewhere
(a `;`-joined cd: rule row "a ; before a cd voids the dir read"). The one
exception is the commit-directory read's sentinel
`UNREADABLE_DIR`: a directory change before a commit that cannot be resolved
(see `commit_target_dir`) or commits in more than one location, which the
develop guard turns into a block with a remedy rather than a live-state
evaluation, because the live state is not the one place the commits run.

WHY ONLY A PURE `&&` CHAIN
--------------------------
`a && b` runs b only when a succeeded, so after `git switch X && …` the rest of
the chain runs on X or not at all. `a; b` runs b even when a FAILED (a dirty
tree that conflicts, a name that already exists for `-c`), so the commit can
land on the original branch; `||`, `|` and `&` give no ordering guarantee
either. So EVERY join in the command must be `&&` — a `;` anywhere, even
after the commit, lets a second commit run elsewhere. The commit-directory
read follows the same rule: a directory read from `cd`/`pushd`/`-C` holds only
when the commit runs after the change, which only an `&&` guarantees.

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

Run as a script it reads the command from GUARD_CMD and prints three lines:
the switch target; the commit directory, or `UNREADABLE_DIR` ("?") when a
directory change before a commit cannot be read or the commits run in more
than one location (the develop guard blocks on it); and "1" when every
non-commit segment of the commit-directory read is inert (see
`_commit_target`). Each is empty when None or False. The board gate reads
line 1 only. Pinned by the "switch:" and "cross-repo:" rows in both guards'
.probe.sh files.

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
# subcommands, none of which can move HEAD or the directory (under the
# trusted-config assumption below). Anything else — a git alias (`git co`),
# `cd`, `make`, `pnpm`, a function, `$CMD` — voids the target, because what it
# runs cannot be known from the text. `mv` and `rm` are absent: they write
# paths of the caller's choosing, and `git mv -f h.txt .git/HEAD` rewrites HEAD
# (git 2.50.1 exits 0 despite "invalid path"). `push` is absent:
# `--receive-pack`/`--exec` run an arbitrary command over a local transport
# (measured, git 2.50.1).
#
# The trusted-config assumption, the one canonical statement of it for this
# module and both guards that consume it: every read here assumes trusted
# repository config and hooks. diff.external, textconv, core.fsmonitor and
# commit hooks can run commands and are not modelled; not verified.
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


def _blank_fd_redirects(part):
    """`part` with every numeric fd redirect blanked to the same length, so
    offsets into the original still line up."""
    return _FD_REDIRECT.sub(lambda m: " " * len(m.group()), part)


def _has_non_and_join(blanked):
    """True when `blanked` (fd redirects already blanked) holds any join other
    than `&&`, a subshell or group, or a substitution."""
    return _NON_AND_SEPARATOR.search(blanked.replace("&&", " ")) is not None


def _rest_moves(view, values, start):
    """True unless `view[start:]` is provably unable to move the branch or the
    directory (trusted-config assumption: see `_INERT_GIT_SUBCOMMANDS`): the
    whole remainder is `&&`-joined (a numeric fd redirect such as `2>&1` is
    not a join), every segment is `git <subcommand> …` with the
    subcommand (the second word, so no global flag) in
    `_INERT_GIT_SUBCOMMANDS`, no word of any segment has a `.git` path
    component (`.git/HEAD`, `./.git/x`, `x/.GIT/y`), and no `log`/`diff`/
    `show` segment carries `--output` (it writes an arbitrary file). The
    subcommand is read UNRESOLVED from the quote-stripped view, so a quoted
    `"git"` is a placeholder, not `git`; the `.git` and `--output` checks read
    the RESOLVED words, so a quoted `".git/HEAD"` or `"--output=…"` is still
    seen."""
    rest = _blank_fd_redirects(view[start:])
    if _has_non_and_join(rest):
        return True
    pos = start
    for segment in rest.split("&&"):
        seg_start, pos = pos, pos + len(segment) + 2
        if _segment_moves(view, values, seg_start, seg_start + len(segment)):
            return True
    return False


def _segment_moves(view, values, start, end):
    """True unless `view[start:end]` is one inert segment: `git <subcommand>
    …` with the subcommand (the second word, so no global flag and no prefix
    assignment) in `_INERT_GIT_SUBCOMMANDS`, no word with a `.git` path
    component, and no `--output` on a `log`/`diff`/`show`. The subcommand is
    read UNRESOLVED (a quoted `"git"` is a placeholder, not `git`); the `.git`
    and `--output` checks read the RESOLVED words."""
    words = view[start:end].split()
    if len(words) < 2 or words[0] != "git" or words[1] not in _INERT_GIT_SUBCOMMANDS:
        return True
    resolved = _words(view, values, start, end)
    if any(_names_git_dir(w) for w in resolved):
        return True
    return words[1] in _OUTPUT_SUBCOMMANDS and any(_WRITING_OPTION.match(w) for w in resolved)


def switch_target(text):
    """The branch a leading `git switch …` / `git checkout -b|-B …` moves to,
    when nothing else in the command can move the branch or the checkout
    (trusted-config assumption: see `_INERT_GIT_SUBCOMMANDS`); else None.

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
# step over; none takes a value. `--git-dir` and `--work-tree` are deliberately
# absent — they relocate the repository in ways a toplevel comparison does not
# model — and so is `-c`: a `-c <key>=<value>` can relocate the work tree
# (`core.worktree`) or run a command, and no list of dangerous keys is
# attempted. Meeting any flag outside this list returns None.
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
# A shell prefix assignment word, `NAME=value` (value possibly empty).
_PREFIX_ASSIGNMENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")


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


# The directory state after a `cd`/`pushd`/`popd` (or a `-C` step) the hook
# cannot resolve. It can never be a real absolute path, which always starts
# with `/`, so it cannot collide with one.
UNREADABLE_DIR = "?"

_DIR_CHANGERS = ("cd", "pushd", "popd")

# `source x` / `. x` run a script in the current shell, so what they change
# (the directory included) is unknown.
_SOURCE_WORDS = ("source", ".")

# The walk state for the checkout the command STARTS in, whose directory the
# hook does not know (a commit there is judged on the live state). Distinct
# from None, which means "void", and from `UNREADABLE_DIR`; not an absolute
# path, and not returned from `_commit_target` (row: "two bare commits read
# nothing"). A walk state that is none of `_START`, `UNREADABLE_DIR` or an
# absolute path is a RELATIVE location reached from the starting checkout by
# plain relative steps. Compare states with `==`, never `is`.
_START = "<start>"


def _plain_relative(step):
    """True when a relative directory word can be joined onto a known base:
    non-empty, no `..` step, no unresolved quoted span, no control character,
    `$`, backtick, glob character or `~`."""
    return (
        bool(step)
        and QUOTED_SPAN not in step
        and not _has_parent_step(step)
        and not re.search(r"[\x00-\x1f$`*?\[~]", step)
    )


def _step_dir(step, base):
    """The directory after one `-C <step>` (git or env) from `base` (`_START`,
    an absolute path, a relative location or `UNREADABLE_DIR`), or None when it
    cannot be read. An absolute step stands alone; a relative one stays
    unreadable on an unreadable base (row: "an unreadable cd keeps a relative -C
    unreadable") and joins onto a known base, which from the starting checkout
    makes the step itself the relative location (row: "a relative -C from the
    starting checkout reads the relative path"). A non-plain one is void."""
    if step.startswith("/"):
        return _absolute_dir(step)
    if base == UNREADABLE_DIR:
        return base
    if not _plain_relative(step):
        return None
    if base == _START:
        return step
    return os.path.join(base, step)


def _changed_dir(words, here):
    """The directory state after a `cd`/`pushd`/`popd` segment, from `here`.

    Leading `--`, `-L` and `-P` words (any number, any order) are skipped; what
    remains must be exactly one argument that is not another flag or a `+N`
    stack index, else `UNREADABLE_DIR` (rows: "a bare cd before a commit
    blocks", "cd - before a commit blocks", "cd with an unsupported flag is
    unreadable", "cd with only a flag is unreadable"). `popd` is
    `UNREADABLE_DIR` (row: "popd before a commit blocks"). An absolute argument
    sets the directory whatever came before it (row: "a second absolute cd moves
    the dir read"); one the hook cannot read (a `..` step, an expansion, a
    glob) is unreadable. A plain relative argument joins onto the current
    location; from the starting checkout it becomes the relative location
    itself (row: "a relative cd from the starting checkout reads the relative
    path"), and on an unreadable state it leaves it as it was. When `CDPATH` is
    set and non-empty the shell may search it for a relative argument, so every
    relative `cd`/`pushd` argument is `UNREADABLE_DIR` (row: "a relative cd is
    unreadable while CDPATH is set")."""
    if words[0] == "popd":
        return UNREADABLE_DIR
    args = words[1:]
    while args and args[0] in ("--", "-L", "-P"):
        args = args[1:]
    if len(args) != 1 or args[0].startswith(("-", "+")):
        return UNREADABLE_DIR
    arg = args[0]
    if arg.startswith("/"):
        return _absolute_dir(arg) or UNREADABLE_DIR
    if not _plain_relative(arg) or os.environ.get("CDPATH"):
        return UNREADABLE_DIR
    if here == UNREADABLE_DIR:
        return here
    if here == _START:
        return arg
    return os.path.join(here, arg)


def _commit_dir(words, base):
    """The directory a `[env -C <dir> …] git [globals] commit …` segment runs
    in, starting from `base` (`_START`, an absolute path or `UNREADABLE_DIR`),
    or None when it cannot be read (void). A bare commit returns `base`
    unchanged, `_START` included.

    Leading `NAME=value` prefix assignments (the override token's position)
    are skipped: they set the commit's environment, not its directory. A
    GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR one never gets
    here — `_relocating_env` has already voided the whole read.

    `env` in front of git is read only through `-C <dir>`, `--chdir <dir>` or
    `--chdir=<dir>` (at least one), each resolved like a `git -C` step;
    any other `env` option, or `env` with no directory option, is not read."""
    while words and _PREFIX_ASSIGNMENT.match(words[0]):
        words = words[1:]
    if not words:
        return None
    here = base
    if words[0] == "env":
        i, moved = 1, False
        while i < len(words):
            word = words[i]
            if _PREFIX_ASSIGNMENT.match(word):
                i += 1
            elif word in ("-C", "--chdir") or word.startswith("--chdir="):
                if word.startswith("--chdir="):
                    step, width = word[len("--chdir=") :], 1
                elif i + 1 < len(words):
                    step, width = words[i + 1], 2
                else:
                    return None
                here = _step_dir(step, here)
                if here is None:
                    return None
                moved = True
                i += width
            else:
                break
        if not moved:
            return None
        words = words[i:]
    if not words or words[0] != "git":
        return None
    i = 1
    while i < len(words) and words[i].startswith("-"):
        flag = words[i]
        if flag == "-C":
            if i + 1 >= len(words):
                return None
            here = _step_dir(words[i + 1], here)
            if here is None:
                return None
            i += 2
        elif flag in _GIT_SKIP_FLAG:
            i += 1
        else:
            return None
    if i >= len(words) or words[i] != "commit":
        return None
    return here


def commit_target_dir(text):
    """The one directory every `git commit` in `text` runs in, else None;
    `UNREADABLE_DIR` when a directory change before a commit cannot be read.
    The directory is absolute, or a normalised plain RELATIVE path reached from
    the starting checkout (no `..` step); the caller resolves a relative one
    against its own working directory, which is the starting checkout.

    The command must be a pure `&&` chain (every join `&&`; a numeric fd
    redirect such as `2>&1` is not a join). The directory is followed through
    the chain in order: every `cd <dir>` / `pushd <dir>` sets it (an absolute
    one outright, a plain relative one joined onto the current location; from
    the starting checkout the relative path itself is the location, so
    `cd sub && git commit` reads `sub`), and each commit may add `git -C <dir>`
    or `env -C <dir>` (`--chdir`) steps resolved the same way. A change AFTER
    the last commit is not read (row: "a pushd after the commit does not move
    it").

    `UNREADABLE_DIR` (a block, not a live-state evaluation) when the commits
    cannot be placed in one checkout: a change before a commit that cannot be
    resolved (`popd`, `cd -`, a bare `cd`, a flag other than `--`/`-L`/`-P` or a
    second argument on `cd`/`pushd`, `~`, an expansion, a glob, a `..` step,
    or a relative argument while `CDPATH` is set, or a `source x` / `. x`
    segment, which runs arbitrary code in the shell), unless a later absolute
    `cd`/`-C` resets the directory; or commits in more than one location (two
    directories, or the starting checkout and another; row: "a bare commit and
    a commit after a cd block"). A `..` step is refused because `cd` and
    `git -C` may follow a symlink where `normpath` only edits the text (not
    verified here). In a `-C` step the unresolvable inputs are not read (None)
    instead. Commits that all run in the starting checkout read nothing.

    None for any commit the hook cannot place, so the live state is judged:
    any join other than `&&` (row: "a ; after the commit voids the dir read"),
    a `commit` word in a segment that is not a plain
    `[env -C <dir>] git [globals] commit` (row: "a commit word outside a git
    commit segment voids the dir read"), a commit segment carrying any
    `-c <key>=<value>` global flag (`core.worktree` relocates the work tree; no
    list of safe keys is attempted; row: "a -c global flag voids the dir
    read"), a commit inside a command substitution or a `bash -c`/`eval`
    wrapper, an unexpandable `-C` directory, and a GIT_DIR / GIT_WORK_TREE /
    GIT_INDEX_FILE / GIT_COMMON_DIR mention anywhere in the raw text (an
    exported one relocates the commit whatever `-C` says; row: "a quoted
    GIT_COMMON_DIR mention voids the dir read").

    Leading `NAME=value` prefix assignments on a commit segment (such as
    `TZUROT_ALLOW_DEVELOP_CODE_COMMIT=1 git -C <dir> commit`) are skipped,
    not refused; a GIT_* one still voids the read through the mention rule
    above. (`switch_target` is unchanged: a leading assignment voids it.)
    """
    return _commit_target(text)[0]


def _commit_target(text):
    """`(directory, others_inert)`: the `commit_target_dir` reading, plus
    whether every segment other than the commit segment(s) and the
    `cd`/`pushd`/`popd` segments is inert (`_segment_moves`, the per-segment
    rule `switch_target` applies). A non-inert one (`ln -sfn`, `mv`, a git
    alias) can re-point the read directory after the hook resolved it, so a
    False must not earn the different-repository silence; the directory is
    still returned, because re-pointing at a sibling worktree only adds a
    block. A directory change does not clear it: it is how the directory is
    set, followed in order (row: "a relative cd joins onto a known absolute
    dir"); the one exception is `source`/`.`, which runs arbitrary code and
    clears it like `make` (row: "a source after the commit does not block, but
    clears inert"). `(None, False)` whenever no directory is read;
    `(UNREADABLE_DIR, False)` when any commit follows a directory change that
    cannot be resolved, or the commits run in more than one location. The
    internal `_START` marker (the starting checkout) is meant to stay inside
    this function (row: "two bare commits read nothing"); a relative location
    is returned as a normalised relative path."""
    if _relocating_env(text):
        return None, False
    if substitution_spans_matching(text, lambda s: _COMMIT_WORD.search(s) is not None):
        return None, False
    if wrapped_command_strings(text):
        return None, False
    scanned = _view(strip_heredoc_bodies(text))
    if scanned is None:
        return None, False
    view, values = scanned
    if re.search(r"[`{}]", view):
        return None, False
    # A heredoc strip keeps the newline that ends the opener's line; a
    # trailing one separates nothing.
    view = view.rstrip()
    if _has_non_and_join(_blank_fd_redirects(view)):
        return None, False

    here = _START
    results = []
    inert = True
    pos = 0
    for sep in [*_SEGMENT_SPLIT.finditer(view), None]:
        seg_start = pos
        end = sep.start() if sep is not None else len(view)
        words = _words(view, values, pos, end)
        pos = sep.end() if sep is not None else len(view)
        if not words:
            continue
        mover = _dir_change_words(words)
        if mover is not None:
            here = _changed_dir(mover, here)
            continue
        if _is_source(words):
            here = UNREADABLE_DIR
            inert = False
            continue
        if not any(w.lower() == "commit" for w in words):
            if _segment_moves(view, values, seg_start, end):
                inert = False
            continue
        results.append(_commit_dir(words, here))
    if not results:
        return None, False
    if UNREADABLE_DIR in results:
        return UNREADABLE_DIR, False
    if None in results:
        return None, False
    found = {r if r == _START else os.path.normpath(r) for r in results}
    if found == {_START}:
        return None, False
    if len(found) != 1:
        # Commits in more than one location (two directories, or the starting
        # checkout and another): no single checkout to judge.
        return UNREADABLE_DIR, False
    return found.pop(), inert


def _command_words(words):
    """`words` from the command word on, past `NAME=value` assignments and
    `command`/`builtin`, which leave a directory change in place."""
    while words and (_PREFIX_ASSIGNMENT.match(words[0]) or words[0] in ("command", "builtin")):
        words = words[1:]
    return words


def _dir_change_words(words):
    """`words` from the `cd`/`pushd`/`popd` word on when the segment is one,
    else None."""
    words = _command_words(words)
    if words and words[0] in _DIR_CHANGERS:
        return words
    return None


def _is_source(words):
    """True when the segment's command word is `source` or `.`: it runs a
    script in the current shell, which can change directory or anything else."""
    words = _command_words(words)
    return bool(words) and words[0] in _SOURCE_WORDS


if __name__ == "__main__":
    command = os.environ.get("GUARD_CMD", "")
    # Line 1: the switch target; line 2: the commit directory, or the
    # sentinel "?" when a directory change before a commit cannot be read, or
    # the commits run in more than one location (the develop guard blocks on
    # it); line 3: "1" when every non-commit,
    # non-cd segment is inert. Each line is empty for None or False.
    try:
        target = switch_target(command)
    except Exception:
        # Fail toward the live-state evaluation, the guards' pre-existing
        # behaviour, rather than toward any reading of the command.
        target = None
    try:
        commit_dir, others_inert = _commit_target(command)
    except Exception:
        commit_dir, others_inert = None, False
    print(target or "")
    print(commit_dir or "")
    print("1" if others_inert else "")
    sys.exit(0)
