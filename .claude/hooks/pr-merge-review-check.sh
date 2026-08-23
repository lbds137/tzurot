#!/bin/bash
# PreToolUse hook: before `gh pr merge <N>`, fetch the latest claude[bot] review
# comment for that PR and dump its content into Claude's context. Blocks the
# merge on first invocation per (PR, review-comment-id); allows on retry once
# the same review-comment-id has been "acked" (i.e., already injected once).
#
# This enforces context-presence of the post-autosquash review before any
# merge call lands. The agent can still ignore what it sees — but the content
# is structurally in the context window, removing the "I forgot to fetch" path.
#
# Background: .claude/rules/00-critical.md "Never Merge PRs Without Completed
# CI" #3 says "claude-review turning green only means it finished posting — it
# does NOT mean its content was read." The rule existed but relied on agent
# attention; this hook is the structural backstop.
#
# It also carries the release-finalize reminder for PRs based on `main`. That
# reminder used to be its own PostToolUse hook firing after the merge, but
# non-blocking PostToolUse output never reaches the agent (probed directly,
# every matcher), so it printed into a void across every release. This hook is
# the nearest channel that provably delivers: it fires on the same `gh pr merge`
# command and blocks, and blocking-path stderr was observed reaching context.

set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ "$TOOL_NAME" != "Bash" ] && exit 0

# Decide the PR number from the ARGUMENT VECTOR of a real `gh pr merge`
# invocation, not from a text scan of the whole command.
#
# The text scan this replaces was wrong in two ways that both END IN AN
# UNREVIEWED MERGE, which is the one outcome this hook exists to prevent. It
# matched the phrase anywhere in the command, so `gh pr comment N --body "...gh
# pr merge 1..."` armed the gate on PR 1 (fired in production twice); and it
# stripped to the FIRST occurrence, so `echo gh pr merge 1 && gh pr merge 2002`
# extracted 1. Either way the gate fetches some unrelated PR — and when that PR
# has no review and a base other than `main`, the hook exits 0 and the real
# merge proceeds with nothing read.
#
# `shlex` gives quote-awareness (a quoted --body is ONE token, so prose can
# never match) and operator tokens (so `gh` is only a command when it starts
# the line or follows an operator). Python is already a hard dependency of
# three sibling hooks, so this adds no new one.
#
# Fails CLOSED by design, in both directions: an unparseable command falls back
# to the old permissive scan rather than arming nothing, because silently not
# arming is the same hole under a different name.
# Cheap Bash-level reject FIRST. This hook is registered on every Bash call, so
# without this guard a python3 process would start for `ls`, `git status`, and
# every other command in the session — on a RAM-constrained machine, for a check
# that is irrelevant to all of them. The tokenizer below only ever runs on a
# command that at least mentions the phrase.
# Held in a variable rather than written inline: an unquoted `[[ =~ ]]` regex
# whose bracket expression contains `(` derails bash's own parser, and it fails
# at the END of the file with a misleading "unexpected EOF" rather than here.
# Deliberately PERMISSIVE: it only decides whether to spawn python, and the
# tokenizer does the real work. Requiring a boundary before `gh` made it reject
# quote-wrapped invocations (`bash -c "gh pr merge N"`) before anything could
# look at them. Only the trailing boundary matters, so `gh pr merge-queue` and
# similar still fall through.
MERGE_PHRASE_RE='gh[[:space:]]+pr[[:space:]]+merge($|[[:space:]])'
if ! [[ "$COMMAND" =~ $MERGE_PHRASE_RE ]]; then
    exit 0
fi

MERGE_EXTRACT=$(COMMAND="$COMMAND" python3 << 'PYEOF'
import os, re, shlex, sys

raw_command = os.environ.get("COMMAND", "")

# Cheap reject before any parsing: no phrase, no gate. Keeps the common Bash
# call (which is not a merge) off the parsing path entirely.
# Mirrors the bash-level MERGE_PHRASE_RE above; keep the two in step.
if not re.search(r"gh\s+pr\s+merge($|\s)", raw_command):
    sys.exit(0)

# What opens a new command position. Tested as a PUNCTUATION RUN rather than an
# enumerated set: shlex returns adjacent punctuation as ONE token, so `a &&( gh
# pr merge N )` yields `&&(` — which no enumerated set contains, leaving the
# position stuck and the merge ungated. Keywords are separate because bash also
# starts a command after them and they arrive as ordinary words.
PUNCTUATION = set("();<>|&")
KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do",
            "case", "select", "{", "!"}

# Utilities that RUN the command that follows them, so they do not consume the
# command position — same idea as the assignment-prefix skip below. Without
# this, `env FOO=bar gh pr merge N` extracted nothing at all and the merge went
# ungated. `env` also takes assignments, which the existing skip then handles.
WRAPPERS = {"env", "nohup", "time", "command", "exec", "sudo", "stdbuf",
            "timeout", "xargs", "eval"}

# Programs whose `-c` argument is a shell command. Gating on these keeps the
# recursion from firing on the many unrelated tools with a `-c` flag —
# `grep -c "<the phrase> N" file` would otherwise arm the gate on N.
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "fish"}

# `-c` as bash actually spells it. Exact equality on both the shell name and
# the flag missed two ordinary shapes, each of which disarmed EVERY gate:
# `bash -lc "gh pr merge N --delete-branch"` (pflag-style clustering — `-lc`
# is not `-c`) and `/bin/bash -c "..."` (the command word is a path, not a
# bare name). Measured: both exited 0 with no review injected, no precondition,
# and no release reminder, while the identical `bash -c` form blocked.
#
# The merge lives inside one opaque quoted token in those shapes, so the
# structural backstop cannot save them either — its premise is that `gh pr
# merge` survived as three ADJACENT top-level tokens, and here they are glued
# inside a string.
#
# Both checks over-arm rather than under-arm: a non-shell whose command word
# basenames to `sh`, or a cluster containing `c` that bash would read
# differently, costs a recursion into a string that usually resolves nothing.
def command_name(word):
    """The bare program name of a command word, which may be path-qualified.

    `/bin/bash` and `bash` are the same program to everything that matters
    here, and so are `/usr/bin/env` and `env`. Matching the sets by exact
    string missed every path-qualified spelling — measured, `/bin/bash -c
    "gh pr merge N --delete-branch"` exited 0 with no gate at all.
    """
    return "" if word is None else word.rsplit("/", 1)[-1]


def is_shell_command(word):
    return command_name(word) in SHELLS


CLUSTERED_C = re.compile(r"^-[A-Za-z]*c[A-Za-z]*$")


def opens_command(token):
    # `token and` is load-bearing: `all()` over an empty string is True, so an
    # empty token would read as an operator. That ended the PR-number scan on
    # `gh pr merge '' 2002` before it reached the number — an under-arm.
    return bool(token) and (token in KEYWORDS or all(ch in PUNCTUATION for ch in token))

# `str.isdigit()` is true for superscripts and Arabic-Indic digits; the bash
# regex it replaced was strictly ASCII.
ASCII_DIGITS = re.compile(r"[0-9]+")

# `--delete-branch` and its shorthand. ANCHORED to a whole token, which is what
# scopes it: `--body "remove the -d flag"` is one token carrying spaces, so it
# cannot match, and `-delete` from a chained `find . -delete` is a different
# token belonging to a different command entirely.
#
# `-[A-Za-z]*d[A-Za-z]*` covers the cluster form (`-rd`) because pflag packs
# boolean shorthands. It cannot match `--delete-branch` itself — after the lead
# `-` the class admits letters only, and the second `-` stops it — so the two
# patterns never double-count.
#
# The cluster pattern accepts any letter run containing a `d`, which is exact
# only while `-d` is the sole `gh pr merge` shorthand containing that letter.
# Read off `gh pr merge --help` (gh 2.65.0): -A -b -F -d -m -r -s -t, plus the
# inherited -R. Only `-d` qualifies today. A future gh adding another `d`-
# bearing shorthand would make this over-arm — the accepted direction here, but
# this list is what a reader should re-check rather than re-derive.
#
# The trailing `(?:=|$)` is load-bearing, not decoration. pflag accepts
# `--flag=value` for BOOLEANS, measured against this `gh`: `--draft=true`
# parses, and `--draft=notabool` fails with strconv.ParseBool — so
# `--delete-branch=true` is a real invocation shape. Anchoring on `$` alone let
# it through, which is an UNDER-arm: the merge proceeds ungated and deletes the
# branch, the one direction this file must never fail in. It was also strictly
# worse than the raw fallback that used to sit below this, which already
# allowed `=`.
DELETE_FLAG_LONG = re.compile(r"^--delete-branch(?:=|$)")
SHORT_CLUSTER = re.compile(r"^-([A-Za-z]+)$")

# `gh pr merge`'s VALUE-taking shorthands. pflag glues a value onto a short
# flag — measured, `gh pr list -L2` behaves identically to `-L 2` — so in a
# single-dash cluster everything after the first value-taking letter is that
# value, not more flags. Without this, `-bd` (a body of "d") read as carrying
# `-d` and produced a false block on a merge that would never delete anything.
#
# From `gh pr merge --help` (gh 2.65.0): -A author-email, -b body, -F body-file,
# -t subject, plus the inherited -R repo. The booleans are -d, -m, -r, -s.
VALUE_TAKING_SHORTS = set("AbFtR")


def carries_delete_flag(token):
    """Whether one argument token is `--delete-branch` or a cluster holding -d.

    Scans a short cluster left to right and stops at the first value-taking
    letter, because pflag stops treating the rest as flags there. `-rd` carries
    the flag (`r` is boolean); `-bd` does not (`d` is `-b`'s value); `-db` does
    (`d` precedes the value-taker).

    Known gap, unfixed: a value passed as a SEPARATE token (`-t -drafty`) is
    still scanned as an argument, because the walk has no notion of a token
    consumed by the previous one. pflag rejects a `-`-leading token as a value
    in most shapes, and the failure direction is an over-arm.
    """
    if DELETE_FLAG_LONG.match(token):
        return True
    cluster = SHORT_CLUSTER.match(token)
    if cluster is None:
        return False
    for letter in cluster.group(1):
        if letter == "d":
            return True
        if letter in VALUE_TAKING_SHORTS:
            return False
    return False

# THE FALLBACK PATHS REPORT NO FLAG, and that asymmetry is deliberate.
#
# legacy_scan, adjacent_merge_scan, and the depth cap all exist to OVER-arm:
# when the position logic cannot model a command's shape, they resolve a PR
# number anyway so the review gate still fires. That trade is right for the
# review gate, whose over-arm costs one retry past an unrelated review.
#
# It is wrong for the delete-branch guard, which is NOT ackable. Measured:
# `echo decoy \<newline>  gh pr merge 2002 --delete-branch` is ONE echo in real
# bash, but shlex leaves `gh pr merge` adjacent, so the backstop resolves PR
# 2002 — and with a flag read off the same text the guard blocked permanently
# on a command that never runs `gh`. An earlier version of this file scanned
# raw text for the flag on exactly these paths for the stated reason that they
# "already choose over-arming as the safe direction"; that reasoning does not
# survive hanging a non-recoverable check off the same extraction.
#
# So the guard acts only on a PR the precise command-position scan resolved.
# On a fallback the flag reads false and the merge proceeds — a missed block
# leaves an orphaned local branch, which `git branch -D` fixes, while a false
# block on a mis-parsed command has no way out at all.


def starts_new_statement(tokens, linenos, idx):
    r"""True when `tokens[idx]` begins a new statement because of a NEWLINE.

    A bare newline separates commands in bash, but shlex emits no token for it,
    so a walk over `tokens[start:]` strolls from one statement into the next.
    Measured: `gh pr merge 2002 --rebase\ngit branch -d old` puts `-d` on line
    2, and the flag walk found it, producing a false block for a merge that
    never carried the flag. The line numbers are the only evidence available.

    The comparison is against where the previous token ENDS, not where it
    starts, and that distinction is the whole correctness of this function.
    `shlex.lineno` counts every newline it consumes INCLUDING those inside a
    quoted token, while the number it reports for a token is where that token
    BEGAN. So a multi-line quoted argument — `--title "line one\nline two"`,
    an ordinary thing to pass a merge commit — leaves the next token on a
    later line than the value started on, and a start-line comparison reads
    that as a statement break INSIDE one invocation. Measured, both halves:
    the flag walk stopped before `--delete-branch` (an under-arm: the guard
    silently does not fire), and with the value placed before the number the
    PR-number walk stopped too, resolving nothing and disarming the review
    gate and the release reminder along with it.

    Adding the token's own embedded newline count fixes that, and subsumes the
    `\`-continuation case that previously needed an explicit exception: shlex
    emits a literal `"\n"` TOKEN for an escaped newline, whose span carries
    the newline that the following token's line number reflects. One rule now
    covers both instead of a rule plus a special case.
    """
    if idx == 0:
        return False
    return linenos[idx] != linenos[idx - 1] + tokens[idx - 1].count("\n")


def is_redirection(token):
    """A punctuation run that REDIRECTS rather than separates.

    Bash ends a command at `&&`, `;`, `|`; it does not end one at `>`, `<`, or
    `2>&1` — `cmd a > f b` still passes both `a` and `b`. shlex hands back
    `2>&1` as `2`, `>&`, `1`, and `>&` is all-punctuation, so the generic
    boundary test cannot tell the two apart. Containing `<` or `>` is what
    separates them, and it is why `>&` does not count as a separator despite
    carrying an `&`.
    """
    return bool(token) and all(ch in PUNCTUATION for ch in token) and any(ch in "<>" for ch in token)


def has_delete_flag(tokens, linenos, start):
    """Whether the invocation at `start` carries the delete-branch flag.

    Deliberately NOT reusing invocation_args, whose strictness the PR-number
    scan depends on: `gh pr merge 2>&1` tokenizes as `2`, `>&`, `1`, and a
    redirection-tolerant walk would read that `2` as the PR number and gate a
    completely unrelated PR — the wrong-PR failure this file's whole tokenizer
    exists to prevent.

    The flag search has the opposite risk profile: collecting too FEW tokens
    misses a real `--delete-branch` and lets the merge through ungated (the one
    direction this hook must never fail in), while collecting too many can only
    over-arm. So this walk steps over redirections and stops only at a real
    separator.

    Whether a token IS the flag is `carries_delete_flag`'s question, including
    the separate-token gap it documents; this walk only decides which tokens
    get asked.
    """
    skip_target = False
    for idx in range(start, len(tokens)):
        if starts_new_statement(tokens, linenos, idx):
            break
        token = tokens[idx]
        if is_redirection(token):
            # A redirection operator consumes exactly the NEXT token as its
            # target, and a target is never a flag no matter what it looks
            # like. Skipping only the operator left the target scannable, so
            # `gh pr merge N --rebase > -d` — a file literally named `-d` —
            # read as the flag and produced a false, unretryable block.
            skip_target = True
            continue
        if skip_target:
            # A `\`-continuation between the operator and its target is not the
            # target. Consuming it as one left the real target scannable, which
            # re-opened the `> -d` false block one line down.
            if token != "\n":
                skip_target = False
            continue
        if opens_command(token):
            break
        if carries_delete_flag(token):
            return True
    return False


def invocation_args(tokens, linenos, start):
    """The argument tokens of the invocation beginning at `start`.

    Stops at the first operator, which is the same boundary the PR-number scan
    uses — so `gh pr merge 2002 --rebase && git branch -d x` yields only
    `--rebase`. Scoping the flag search to THIS range is the whole fix: a raw
    match over the command text reported `-d` from the chained `git branch`,
    and since the guard is not ackable that false block told the agent to tear
    down an unrelated worktree.
    """
    args = []
    for idx in range(start, len(tokens)):
        if starts_new_statement(tokens, linenos, idx):
            break
        token = tokens[idx]
        if opens_command(token):
            break
        args.append(token)
    return args


def strip_heredocs(text):
    """Remove heredoc BODIES before tokenizing.

    A heredoc body is data, never commands — bash will not execute a word in
    it no matter what it looks like. `shlex` has no concept of heredocs, so
    without this the body is tokenized as if it were shell, and any example
    command quoted in a PR body, commit message, or issue text can arm the
    gate on whatever digit follows it. That is not hypothetical: this hook
    fired on its own PR's `gh pr create`, extracting a PR number out of a
    markdown table cell describing the very bug being fixed.

    Handles `<<MARKER`, `<<'MARKER'`, `<<"MARKER"`, and the `<<-` indent form,
    for identifier-shaped markers only. A non-identifier marker leaves its body
    un-stripped, which over-arms rather than under-arms — the safe direction.

    An UNTERMINATED match strips NOTHING. The opener is found by regex over raw
    text, which cannot tell a real redirection from the same characters sitting
    inside a quoted argument — and dropping to end-of-text on a false match
    deletes any real invocation that followed it, producing a total gate bypass
    rather than a wrong PR. That is the worse of the two directions, so the
    unterminated case keeps the text and accepts over-arming instead.

    `<<<` (here-string) is excluded for the same reason: its trailing `<` plus a
    bare word looks like an opener to a naive regex, and the marker never
    terminates, so it hit exactly the bypass above.

    One unterminated opener disables stripping for the WHOLE command, not just
    that heredoc — deliberate, since the alternative is deciding which half of
    an ambiguous parse to trust, and the cost is only over-arming.

    Two known limits, both over-arming: only the FIRST opener on a line is
    recognized (`cmd <<A <<B` leaves B's body unstripped), and the terminator
    match allows leading whitespace even for the non-`<<-` form, which real
    bash requires at column 0. Both leave heredoc text visible to the
    tokenizer, never hide a real invocation.
    """
    # (?<!<) keeps `<<<` from reading as a heredoc opener.
    pattern = re.compile(r"(?<!<)<<-?\s*(['\"]?)([A-Za-z_][A-Za-z_0-9]*)\1")
    out = []
    pos = 0
    while True:
        match = pattern.search(text, pos)
        if match is None:
            out.append(text[pos:])
            return "".join(out)
        # Keep the redirection operator itself; drop only what it introduces.
        out.append(text[pos : match.start()])
        marker = match.group(2)
        # The body starts after the line carrying the redirection.
        newline = text.find("\n", match.end())
        if newline == -1:
            return text
        terminator = re.compile(r"^[ \t]*" + re.escape(marker) + r"[ \t]*$", re.M)
        end = terminator.search(text, newline + 1)
        if end is None:
            return text
        out.append(text[match.end() : newline + 1])
        pos = end.end()


def legacy_scan(text):
    """The pre-hardening behaviour, kept ONLY as the unparseable fallback.

    Over-arming (the old bug) is recoverable — the agent sees a review for a
    PR it did not ask about and retries. Under-arming is not: the merge just
    proceeds. So when the tokenizer cannot run, take the noisy option.
    """
    after = re.split(r"gh\s+pr\s+merge", text, maxsplit=1)
    if len(after) < 2:
        return "", False
    for token in after[1].split():
        if ASCII_DIGITS.fullmatch(token):
            return token, False
    return "", False


def tokenize(command):
    """Token list plus each token's starting line, or None if it won't parse.

    A newline separates commands, but shlex counts it as plain whitespace and
    never emits it as a token — so `pnpm test\\ngh pr merge 2002` would read as
    one long command and the merge would lose its command position. Record the
    line each token STARTS on to restore it.

    Read the counter BEFORE each token, not after: measured, `lineno` is
    incremented while finishing the token that PRECEDES the newline, so the
    after-value marks the wrong token as having crossed the line.

    Returns None on ANY tokenizer failure, not just the unbalanced-quote
    ValueError. A narrower catch let every other exception escape, crash
    python, and reach the shell's `|| PR_NUM=""` — which is silently NO GATE,
    the exact direction this design refuses.
    """
    try:
        lexer = shlex.shlex(command, punctuation_chars=True, posix=True)
        lexer.whitespace_split = True
        tokens = []
        linenos = []
        while True:
            line_at_start = lexer.lineno
            token = lexer.get_token()
            # ONLY None means end of input. An empty string is a legitimate
            # token (`echo '' && gh pr merge N`), and treating it as EOF
            # truncated the stream and dropped every command after it.
            if token is None:
                break
            tokens.append(token)
            linenos.append(line_at_start)
        return tokens, linenos
    except Exception:
        return None


def adjacent_merge_scan(tokens, linenos):
    """The PR number after the first ADJACENT `gh` `pr` `merge` token triple.

    Scans the TOKENS, not raw text. `legacy_scan` reads the first textual
    occurrence, so a decoy earlier in the command beats the real invocation —
    that would reintroduce the very bug this file exists to fix. Tokens carry
    quoting, so prose inside a quoted argument is ONE token and can never look
    adjacent.
    """
    for i in range(len(tokens)):
        if tokens[i : i + 3] == ["gh", "pr", "merge"]:
            for candidate in invocation_args(tokens, linenos, i + 3):
                if ASCII_DIGITS.fullmatch(candidate):
                    return candidate, False
    return "", False


def extract(text, depth=0):
    """Return the PR number a real `gh pr merge` in `text` targets, or "".

    Recurses into `-c` / `eval` string arguments: `bash -c "gh pr merge N"` is
    ONE quoted token to the tokenizer, so without recursion the invocation is
    invisible — which the naive text scan this replaced did catch, making it a
    regression rather than a pre-existing gap.
    """
    if depth > 3:
        # THE RECURSION CAP FAILS TOWARD ARMING. Returning "" here resolved no
        # PR at all for a merge nested four shells deep, and the caller reads
        # "" as "nothing to gate on" and exits 0 — an UNDER-arm, the one
        # direction this hook must never fail in. The cap itself stays (it
        # bounds recursion depth); what changes is what happens at it.
        #
        # A TOKEN scan at the cap only sees the outermost layer, so a merge
        # still wrapped one-or-more `bash -c` deep tokenizes as a single quoted
        # token and the under-arm just returns one level deeper. This is a raw
        # TEXTUAL over-arm instead: it finds `gh pr merge <n>` at ANY remaining
        # nesting depth. `["']*` sits BEFORE the digits, so it absorbs a quote
        # directly in front of the number — a quoted PR number like
        # `merge "2002"` — not the trailing shell-wrap quote (`merge 2002'`),
        # which needs no help because `(\d+)` stops at the first non-digit
        # anyway. Belt-and-braces for the quoted-number shape, which the nesting
        # probes do not exercise (their numbers are bare). At the cap the input
        # is pathological, so over-arming on the first textual match (even a
        # decoy's) is the safe direction. Pinned by the 5- and 7-level nesting
        # cases in pr-merge-review-check.probe.sh.
        capped = strip_heredocs(text)
        match = re.search(r"gh\s+pr\s+merge\s+[\"']*(\d+)", capped)
        return (match.group(1) if match else ""), False
    command = strip_heredocs(text)
    tokenized = tokenize(command)
    if tokenized is None:
        # Tokenizer failure means fall back to the permissive scan; it never
        # means arm nothing.
        return legacy_scan(command)
    tokens, linenos = tokenized

    at_command_start = True
    # The command word of the segment being scanned — what actually owns any
    # flags that follow. Cleared at every command boundary.
    current_command = None
    # (token_index, kind, value) where kind is "pr" (a number read directly off
    # a top-level `gh pr merge`) or "nested" (a `-c`/`eval` string argument to
    # be scanned recursively). BOTH kinds land in one list so they can be
    # resolved in TOKEN ORDER after the scan.
    #
    # Draining the top level first and only then recursing was wrong by
    # execution order: in `bash -c "gh pr merge 2001" && gh pr merge 2002` the
    # first merge to actually run is 2001, and the gate armed on 2002. Both are
    # real merges, so this was a precision bug rather than a bypass — the safe
    # direction — but arming on the wrong PR shows an unrelated review.
    candidates = []
    for i, token in enumerate(tokens):
        # Same newline boundary the two arg walks use, and for the same
        # reason: a `\`-continuation is not a command break. Resetting the
        # command position on one made `echo decoy \<newline>  gh pr merge N
        # --delete-branch` — ONE echo invocation in real bash — read as a real
        # merge, arm the gate on N, and then hit the NOT-ACKABLE delete-branch
        # guard: a permanent block on a command that never runs `gh` at all.
        #
        # Over-arming here used to be harmless, because the only consequence
        # was the review gate showing an unrelated review and the agent
        # retrying past it. Hanging a non-ackable precondition off the same
        # extraction is what changed that, so the two checks have to agree.
        if starts_new_statement(tokens, linenos, i):
            at_command_start = True
            current_command = None
        if opens_command(token):
            at_command_start = True
            current_command = None
            continue
        # A shell's `-c` argument, or `eval`'s, is a command in its own right;
        # record it WITH ITS INDEX so it resolves in execution order alongside
        # any top-level hit.
        # Which program owns this `-c`? Tracked as the current segment's command
        # word, not the whole prefix and not the immediately-preceding token.
        # Both narrower rules were wrong: a prefix-wide check let `bash
        # --version; grep -c "<phrase> N"` recurse into grep's PATTERN, and the
        # immediately-preceding check missed `bash -x -c "..."`, where a flag
        # sits between the shell and its own `-c`.
        if i + 1 < len(tokens) and CLUSTERED_C.match(token) and is_shell_command(current_command):
            candidates.append((i, "nested", tokens[i + 1]))
        # `eval` is in WRAPPERS, which handles its UNQUOTED form (bash joins the
        # args and runs them). The quoted form is one opaque token, so it needs
        # the recursion as well.
        #
        # Gated on the COMMAND POSITION, exactly like the `-c` check above. The
        # bare-token form fired wherever the word `eval` appeared, including as
        # an argument to something else: measured, `echo eval "gh pr merge 2002
        # --delete-branch"` recursed into echo's own argument and blocked — on a
        # command real bash runs as `echo` and nothing more, against a guard
        # that cannot be acked past.
        if (
            i + 1 < len(tokens)
            and at_command_start
            and command_name(token) == "eval"
        ):
            candidates.append((i, "nested", tokens[i + 1]))
        # `FOO=bar gh pr merge 5` — an assignment prefix does not consume the
        # command position. Missing this made the gate silently skip that shape.
        # A wrapper runs what follows, so it is not the command word itself.
        if at_command_start and command_name(token) in WRAPPERS:
            continue
        if at_command_start and current_command is None:
            current_command = token
        if at_command_start and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*=.*", token):
            continue
        if at_command_start and token == "gh" and tokens[i + 1 : i + 3] == ["pr", "merge"]:
            args = invocation_args(tokens, linenos, i + 3)
            # The flag is read from THIS invocation's arguments only. Whether a
            # later merge, a chained command, or quoted prose carries one is
            # irrelevant — the gate arms on this PR, so it must answer for this
            # PR's flags.
            flag = has_delete_flag(tokens, linenos, i + 3)
            for candidate in args:
                if ASCII_DIGITS.fullmatch(candidate):
                    candidates.append((i, "pr", (candidate, flag)))
                    break
            # This occurrence yielded no PR number — a bare `gh pr merge`, or
            # its arguments ran into an operator first. KEEP SCANNING: `gh pr
            # merge && gh pr merge 2002` would otherwise extract nothing and
            # let the real, explicit merge through completely ungated.
        at_command_start = False

    # Execution order, not level order: the earliest token wins, whether it was
    # a plain invocation or one wrapped in `-c`/`eval`.
    for _, kind, value in sorted(candidates, key=lambda c: c[0]):
        if kind == "pr":
            return value
        found_pr, found_flag = extract(value, depth + 1)
        if found_pr:
            return found_pr, found_flag

    # STRUCTURAL BACKSTOP. Everything above decides WHICH invocation is real,
    # and every bug this file has had was the same shape: that logic failed to
    # recognise one, returned nothing, and the merge proceeded with no gate —
    # the one direction this hook must never fail in. Six such gaps were found
    # by review in a single day (bare-then-real chaining, empty tokens, `-c`
    # wrapping, `env`/`nohup` prefixes, glued punctuation, `eval`), which is
    # what writing a shell parser by hand actually looks like.
    #
    # So: if `gh pr merge` survived tokenization as three ADJACENT tokens, a
    # real invocation is present and the position logic simply did not model
    # its shape. Fall back to the permissive scan rather than exiting clean.
    # Any future gap now degrades to over-arming (the agent sees an unrelated
    # review and retries) instead of a silent bypass.
    #
    # Adjacency is the discriminator that keeps this PR's headline fix: prose
    # inside a quoted `--body` is ONE token, so it never looks adjacent, and a
    # heredoc body is already stripped before it gets here. Only text the shell
    # would actually execute as words reaches this check.
    #
    # adjacent_merge_scan is called only here. The depth-cap path at the top of
    # this function plays the SAME conceptual role — over-arm as the safe
    # fallback when the position logic can't model the shape — but shares no
    # code with it: at the cap there is no reliable tokenization to run
    # adjacency over, so it uses a raw-text regex instead.
    return adjacent_merge_scan(tokens, linenos)


try:
    # Two lines: the PR number, then 1/0 for "this invocation carries the
    # delete-branch flag". The shell reads them positionally.
    pr_number, delete_flag = extract(raw_command)
    print(pr_number)
    print("1" if delete_flag else "0")
except Exception:
    # The whole extraction, not just the tokenizer. Anything escaping here
    # would exit non-zero, hit the shell's `|| PR_NUM=""`, and silently arm
    # nothing — the direction this design refuses. Now structurally true
    # rather than true-by-current-code-shape.
    pr_number, delete_flag = legacy_scan(raw_command)
    print(pr_number)
    print("1" if delete_flag else "0")

PYEOF
) || MERGE_EXTRACT=""

# Line 1: the PR number. Line 2: 1 when THAT invocation carries the
# delete-branch flag. Both empty when the extraction produced nothing.
PR_NUM=$(printf '%s\n' "$MERGE_EXTRACT" | sed -n '1p')
MERGE_DELETES_BRANCH=$(printf '%s\n' "$MERGE_EXTRACT" | sed -n '2p')

# No PR number → bare `gh pr merge`, or the command only mentioned the phrase
# without invoking it. Either way there is nothing to gate on.
if [ -z "$PR_NUM" ]; then
    exit 0
fi

RULE='━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'

# Ack file, defined BEFORE the review fetch because two independent concerns
# key off it now: the review gate (per PR+comment-id) and the release-finalize
# reminder (per PR). /tmp wipes on reboot so the file stays bounded;
# UID-namespaced so concurrent users on a shared host don't cross-contaminate.
ACK_FILE="/tmp/.claude_pr_merge_ack.$(id -u)"
RELEASE_KEY="RELEASE:${PR_NUM}"

# Base-branch resolution. Queried fresh every time it is needed, NOT cached.
#
# The release reminder must be reachable BEFORE the review-existence
# early-exits — a release PR whose claude-review posted nothing (documented in
# 05-tooling.md § claude-review health, observed twice) would otherwise merge
# with no reminder at all, which is the exact silent-drop this hook was moved
# here to end.
#
# The acked-retry path calls this too, and that IS a cost: an ordinary feature
# PR never accumulates a RELEASE ack, so every acked retry for the life of that
# PR resolves the base again. Accepted knowingly — the retarget gap it closes
# is a silently-skipped release reminder, and the path already pays an
# unconditional `gh api` for the review fetch before reaching the ack check, so
# this is a second round trip on an already-network-bound path rather than a
# first one on a free path.
#
# An earlier CACHE of the answer was removed rather than kept, and must not
# come back in any spelling: a PR retargeted from develop to main (or back)
# keeps serving the old base for the life of /tmp, silently suppressing or
# spuriously firing the reminder. A stale answer here reproduces the very
# failure class this hook exists to prevent, so freshness wins over a saved
# API call.
#
# Fails open to "": an unreadable base skips the release block rather than
# blocking a merge on a `gh` blip. The head ref fails open the same way, which
# is what makes the delete-branch guard below degrade to "allow" on a `gh`
# outage rather than to "cannot merge".
#
# Both refs come from ONE call because the delete-branch guard needs the head
# and the release reminder needs the base, and every gated merge already paid
# this round trip for the base alone.
#
# The resolved-flag is separate from the values: either field can legitimately
# come back empty (a `gh` failure, a null field), and keying the cache on
# emptiness would re-issue the call on every subsequent use.
PR_BASE=""
PR_HEAD=""
PR_VIEW_RESOLVED=0
resolve_pr_view() {
    [ "$PR_VIEW_RESOLVED" = 1 ] && return 0
    PR_VIEW_RESOLVED=1
    local view
    view=$(gh pr view "$PR_NUM" --json baseRefName,headRefName \
        --jq '(.baseRefName // ""), (.headRefName // "")' 2>/dev/null || echo "")
    PR_BASE=$(printf '%s\n' "$view" | sed -n '1p')
    PR_HEAD=$(printf '%s\n' "$view" | sed -n '2p')
    return 0
}

# True when this is a release PR whose reminder has not been shown yet.
# Filtering on base=main is the whole test: the project's critical rule
# reserves a `main` base for release PRs.
#
# The ack check runs FIRST, before the network call, so a PR whose reminder was
# already shown costs nothing to re-evaluate.
#
# DELIBERATE ACCEPT for the remaining case: a FIRST block on an ordinary feature
# PR pays one `gh pr view` to discover it is not release-relevant. Two things
# make that acceptable — the same path already makes a `gh api` call to fetch
# the review, so it is network-bound regardless, and it is a blocking gate that
# happens once per review cycle, not a latency-sensitive loop. It also fails
# open, so a `gh` outage degrades to "no reminder", never "cannot merge".
#
# Two cheaper short-circuits were considered and REJECTED, both for correctness:
#
#   - Caching the base per PR. Tried and removed: a PR retargeted develop<->main
#     keeps serving the stale answer for the life of /tmp, which either
#     suppresses the reminder or fires it spuriously. A stale answer here
#     reproduces the exact silent-drop class this hook exists to prevent.
#   - Treating `--delete-branch` as "this is a feature PR" (the old standalone
#     reminder used it as a fast path). It looks free and local, but it
#     suppresses the reminder precisely when the reminder matters MOST: the
#     release block's own text says "Do NOT pass --delete-branch: develop must
#     survive", so keying the skip on that flag would silence the warning in the
#     exact scenario that once deleted `develop`.
release_reminder_due() {
    if [ -f "$ACK_FILE" ] && grep -qxF "$RELEASE_KEY" "$ACK_FILE" 2>/dev/null; then
        return 1
    fi
    resolve_pr_view
    [ "$PR_BASE" = "main" ] || return 1
    return 0
}

# --- delete-branch precondition --------------------------------------------
#
# `--delete-branch` deletes the LOCAL branch by first switching the CURRENT
# worktree off it, then running the equivalent of `git branch -D`. (Both halves
# read off the `gh` binary's own strings: "and switched to branch %s", then
# "Deleted local branch %s" or "failed to delete local branch %s: %w".)
#
# That second half fails outright when some OTHER worktree still holds the
# branch — git's refusal, probed directly in a scratch repo, is "cannot delete
# branch 'X' used by worktree at '<path>'". By then the merge has already
# landed, so the result is: PR merged, remote branch gone, local branch alive,
# and a non-zero `gh` exit that reads like the merge itself failed. The branch
# then looks live to every later `git branch` and survives silently.
#
# Hence the scope is OTHER worktrees only. The current worktree sitting on the
# head branch is the ORDINARY case — it is what "merge my feature branch" looks
# like — and gh resolves it by switching away, so refusing it would block the
# project's most common merge invocation. TASK-530 asked for "checked out
# anywhere"; reading what gh actually does narrowed it to this.
#
# This guard is deliberately NOT ackable, unlike the review gate. An ack exists
# so a merge can proceed once the agent has READ something; here nothing has
# been read — a precondition is unmet, and retrying without fixing it must keep
# failing or the guard is decorative.
#
# Release PRs are excluded for free: they merge without the flag.
#
# Do NOT read this hook as protection for `develop`. If a release PR ever
# carried `--delete-branch`, this fires only when `develop` is held by a
# worktree OTHER than the one running the merge — and the routine release is
# merged from the same checkout that has `develop` current, where the guard
# finds no conflict and the merge proceeds. So the catch is COINCIDENTAL, and
# must not be described as this hook's headline protection.
#
# The systematic backstop is `pnpm ops guard:repo-settings`
# (dev/check-repo-settings.ts): it asserts a non-bypassable `deletion` ruleset
# rule on the long-lived branches, which is what actually stops the
# admin-privileged delete path. That is the thing to fix if it ever regresses,
# not this hook.

# The flag comes from the TOKENIZER, scoped to the armed invocation's own
# arguments — not from a second raw pass over the command text.
#
# A raw pass over the whole command is WRONG here, and not obviously so: it
# matches any dash-token containing a `d` anywhere in the command, so
# `gh pr merge N --rebase && git branch -d old` and
# `... && find . -delete` both armed it, as did a `-d` inside a quoted `--body`.
# That is precisely the quoted-prose false-positive class the tokenizer above
# exists to eliminate, reintroduced one check later — and because this guard is
# NOT ackable, a false block is not a recoverable annoyance: it tells the agent
# to tear down a worktree unrelated to the command, under a banner explaining a
# flag that was never passed.
if [ "$MERGE_DELETES_BRANCH" = "1" ]; then
    resolve_pr_view
    # Every step below fails open to "no conflict": no head ref (gh blip), not
    # a git repo, no worktree holds the branch. Blocking a merge on a broken
    # lookup would be a worse failure than the one being prevented.
    CURRENT_TREE=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
    # An empty CURRENT_TREE is checked EXPLICITLY rather than left to fall
    # through. Without this the comparison below is `path != ""`, which is true
    # for every worktree including the one running the merge — so a failure of
    # this one command turns the guard from fail-open into block-everything,
    # exactly inverting the property the comment above claims. The SHIM_GIT_EXIT
    # probe case only covers BOTH git calls failing together; this is the
    # asymmetric case, and it now holds structurally instead of incidentally.
    if [ -n "$PR_HEAD" ] && [ -n "$CURRENT_TREE" ]; then
        # `git worktree list --porcelain` lists the MAIN checkout as a worktree
        # too, so this one command covers both trees the task names — no
        # separate `git branch --show-current`. A detached worktree emits
        # `detached` instead of a `branch` line and simply never matches.
        # Paths are read with substr rather than by field-splitting so a
        # worktree path containing spaces survives.
        # `cur` comes through the ENVIRONMENT, not `-v`. awk interprets
        # C-style escapes in a `-v` assignment, so a worktree path containing a
        # literal backslash (valid on Linux, unlike in a git ref name) would be
        # rewritten before the comparison — `\t` collapsing to a tab, turning an
        # equal path unequal. ENVIRON is not escape-processed. `want` stays on
        # `-v` because git ref names cannot contain a backslash at all.
        CONFLICT_TREE=$(git worktree list --porcelain 2>/dev/null | CUR_TREE="$CURRENT_TREE" awk \
            -v want="branch refs/heads/$PR_HEAD" '
            BEGIN { cur = ENVIRON["CUR_TREE"] }
            /^worktree / { path = substr($0, 10); next }
            $0 == want   { if (path != cur) { print path; exit } }
        ')
        if [ -n "$CONFLICT_TREE" ]; then
            {
                printf '%s\n' "$RULE"
                printf 'PR MERGE BLOCKED — head branch is checked out in another worktree\n'
                printf '%s\n\n' "$RULE"
                printf 'PR #%s head branch:  %s\n' "$PR_NUM" "$PR_HEAD"
                printf 'Held by worktree:    %s\n\n' "$CONFLICT_TREE"
                printf 'With --delete-branch (or -d), gh merges FIRST and then deletes the local\n'
                printf 'branch. git refuses that delete while another worktree holds the branch,\n'
                printf 'so the merge lands, the remote branch goes away, and the local branch\n'
                printf 'survives looking live — while gh exits non-zero as if nothing merged.\n\n'
                # Both paths are single-quoted so the suggestions stay
                # copy-paste-safe. The detection side was hardened for a
                # worktree path containing a space; printing an unquoted path
                # would break the remediation on that exact case —
                # `git worktree remove /tmp/my worktree` takes an extra
                # positional, and `-C /tmp/my` leaves `worktree` parsed as the
                # subcommand. A path containing a single quote would still
                # mangle these, which is why they are suggestions to read, not
                # commands the hook runs.
                printf 'Fix one of these, then re-run the same command:\n'
                printf "  git worktree remove '%s'\n" "$CONFLICT_TREE"
                printf '  # refuses on a dirty tree — that means uncommitted work lives there.\n'
                printf '  # Look before forcing; the option below needs no --force at all.\n'
                printf '  # or, if that worktree is still needed, move it off the branch:\n'
                printf "  git -C '%s' checkout --detach\n\n" "$CONFLICT_TREE"
                printf 'Retrying without doing one of those will be blocked again — this is a\n'
                printf 'precondition, not a review gate, so there is nothing to acknowledge.\n'
                printf '%s\n' "$RULE"
            } >&2
            exit 2
        fi
    fi
fi

# The reminder body. Written to stderr by both call paths below — beside the
# review on the normal path, alone when no review exists. FORWARD-looking (it
# fires before the merge, not after), which is why there is no `state = MERGED`
# check: state is OPEN at this point by construction. That is a channel-forced
# improvement over the PostToolUse version, which fired post-merge into an
# output stream that never reached the agent.
print_release_block() {
    printf '%s\n' "$RULE"
    printf 'RELEASE PR — base is main. AFTER this merge lands, run finalize NEXT:\n\n'
    printf '  pnpm ops release:finalize --yes\n\n'
    printf 'Rebase-merging a release PR to main creates new SHAs on main. Without\n'
    printf 'finalize, develop keeps its old SHAs and the next release PR shows N\n'
    printf 'commits of false divergence per cycle — ~57 commits of drift accumulated\n'
    printf 'across two skipped cycles before manual cleanup was needed.\n\n'
    printf 'Also part of the post-merge sequence:\n'
    printf '  - Prod migrations run BEFORE the merge (pnpm ops release:premigrate) —\n'
    printf '    if this release has one and it has not run, stop and run it first.\n'
    printf '  - Tag + push the release tag, then create the GitHub Release.\n'
    printf '  - Do NOT pass --delete-branch: develop must survive.\n\n'
}

# Taken by the two "no usable review" exits below. Without a review there is
# nothing to inject, so the review gate itself allows the merge — but a release
# PR still owes its finalize reminder, and stderr only reaches the agent on the
# blocking path, so delivering it means exiting 2 once. A feature PR is
# unaffected and still exits 0 immediately.
#
# $1 is the reason line, because the call sites are NOT the same state: one
# found no comment, another found one that would not parse, a third has already
# surfaced the review. Saying "none found" for all of them would be a banner
# asserting something untrue, which is the whole class this hook's own PR was
# cleaning up.
#
# $2 overrides the body's first line for the same reason. It defaults to the
# no-review wording, which is wrong for the acked-retry caller: there, a review
# exists and was already shown, so claiming the gate "has nothing to surface"
# would be the same species of false banner.
release_block_then_exit() {
    if release_reminder_due; then
        {
            printf '%s\n' "$RULE"
            printf 'PR MERGE GATE — %s for PR #%s\n' "${1:-no usable claude-review}" "$PR_NUM"
            printf '%s\n\n' "$RULE"
            printf '%s\n' "${2:-The review gate has nothing to surface, so it is not blocking on that.}"
            printf 'This block is the release reminder, which does NOT depend on a review\n'
            printf 'existing. Retry the same merge command to proceed.\n\n'
            print_release_block
            printf '%s\n' "$RULE"
        } >&2
        if echo "$RELEASE_KEY" >>"$ACK_FILE" 2>/dev/null; then
            chmod 600 "$ACK_FILE" 2>/dev/null || true
            exit 2
        fi
        # Ack write failed — fail open rather than block forever.
        printf 'WARNING: release-reminder ack write failed (%s) — allowing merge\n' "$ACK_FILE" >&2
    fi
    exit 0
}

# Fetch the most recent claude[bot] comment on this PR. Pull body + id +
# created_at so the ack key is stable per-comment (a fresh review re-runs
# the gate).
#
# `?per_page=100&direction=desc` is required: GitHub defaults to 30 items per
# page in ASCENDING order. A busy PR with many review rounds + bot noise
# (codecov, security scanners) can push the latest claude[bot] comment past
# position 100 if we asked for ascending. With `direction=desc` we get the 100
# MOST RECENT comments — the latest claude[bot] review is realistically always
# in that window. Without these params, the jq filter would silently surface
# an OLDER review (the worst possible failure mode for this gate — fires but
# injects the wrong content).
REVIEW_JSON=$(gh api "repos/lbds137/tzurot/issues/${PR_NUM}/comments?per_page=100&direction=desc" \
    --jq '[.[] | select(.user.login == "claude[bot]")] | sort_by(.created_at) | last' \
    2>/dev/null || echo "")

# No claude-review on this PR (yet, or ever). Allow the merge — the gate is
# only meaningful when there's actually content to surface. The user-facing
# rule still applies: agent should be reading whatever review IS available.
if [ -z "$REVIEW_JSON" ] || [ "$REVIEW_JSON" = "null" ]; then
    release_block_then_exit "no claude-review comment found"
fi

REVIEW_ID=$(jq -r '.id // empty' <<<"$REVIEW_JSON")
REVIEW_TS=$(jq -r '.created_at // empty' <<<"$REVIEW_JSON")
REVIEW_BODY=$(jq -r '.body // empty' <<<"$REVIEW_JSON")

if [ -z "$REVIEW_ID" ] || [ -z "$REVIEW_BODY" ]; then
    # Malformed response or empty review. Allow the merge rather than block on
    # an unparseable state; the rule still nominally applies. The release
    # reminder is independent of that and still owed.
    release_block_then_exit "a claude-review comment was found but did not parse"
fi

# Origin-language scan: reviews that scope findings as "pre-existing" /
# "not a regression" invite dismissal-by-origin — the shortcut the rules ban
# (00-critical § Always Leave Code Better; /tzurot-review-response § rule 2's
# origin-language row). Origin is not a correctness verdict, so when the
# vocabulary appears, the injected block below demands a per-finding merits
# disposition before the merge retry. Line-count (not boolean) so the warning
# can say how much of it there is; false positives cost one reminder
# paragraph, never a block. grep -c prints 0 on no-match but exits 1; the
# herestring isn't a pipeline (pipefail doesn't apply) and errexit isn't set,
# so `|| true` changes nothing today — it documents that the non-zero exit
# is expected and keeps the guard correct if `set -e` ever arrives.
ORIGIN_HITS=$(grep -icE 'pre-?existing|pre-?dates|not a regression|not introduced (by|in) this|existing behavior|consistent with existing|already (present|existed)' <<<"$REVIEW_BODY" || true)

# Per-(PR, comment-id) key. A fresh review (different comment-id) forces
# re-engagement; a retry after ack proceeds.
ACK_KEY="${PR_NUM}:${REVIEW_ID}"

# Acked-retry path: the review has already been surfaced for this comment-id,
# so the review gate itself is satisfied. The RELEASE reminder is still
# evaluated, because it is a separate obligation with a separate ack.
#
# This used to `exit 0` outright, on the reasoning that the reminder "was
# already delivered by the blocking call that wrote this ack". That holds only
# while the base is unchanged: retarget an open PR develop->main between two
# merge attempts on the SAME review comment and the ack still matches, so the
# reminder never fires — the same staleness class as the base cache removed
# earlier, reached through a different door.
#
# The cost objection that kept this open is ANSWERED BY MEASUREMENT, not
# overruled: two earlier rounds asked for `gh pr view` to be kept off these
# paths on the belief they were call-free. They are not. The review fetch above
# is an unconditional `gh api` on every merge attempt, so by the time control
# reaches here the call has ALREADY been paid — closing the gap adds a second
# round trip to an already-network-bound path that runs a handful of times a
# day, which is the exact trade release_reminder_due's own header already
# accepts for the first-block case.
#
# The steady-state cost, stated the unflattering way round: a RELEASE PR pays
# until its reminder fires and is free afterwards (release_reminder_due checks
# the RELEASE ack first), while an ordinary FEATURE PR never accumulates a
# RELEASE ack and therefore pays one call on every acked retry, indefinitely.
# The feature case is the common one, so that is the number to judge this by.
#
# A NOTRELEASE marker would avoid the call and was REJECTED: it is a base cache
# under another name and carries the identical retarget staleness this change
# exists to remove.
if [ -f "$ACK_FILE" ] && grep -qxF "$ACK_KEY" "$ACK_FILE" 2>/dev/null; then
    release_block_then_exit "the review was already acked" \
        "The review for this PR was surfaced and acknowledged on an earlier call."
fi

# First-call path: inject the review into stderr FIRST, then ack and exit 2.
#
# Inject-before-ack ordering matters: if anything interrupts between the two
# steps (signal, stderr buffer issue, partial write), the failure mode under
# inject-first is "review printed but no ack" → next call re-injects (harmless
# double-display). The reversed order would mean "ack written but no inject" →
# next call sees the ack and silently allows the merge without ever surfacing
# the review, which is the exact failure mode this gate exists to prevent.
#
# printf rather than heredoc: an unquoted heredoc terminates on a bare delimiter
# line in the body, so a review that contained `EOF` on its own line would
# silently truncate the injected content. printf has no such delimiter
# semantics — `%s` swallows whatever the variable holds.
RELEASE_DUE=0
if release_reminder_due; then RELEASE_DUE=1; fi
{
    printf '%s\n' "$RULE"
    printf 'PR MERGE GATE — latest claude-review for PR #%s\n' "$PR_NUM"
    printf 'Posted: %s\n' "$REVIEW_TS"
    printf '%s\n\n' "$RULE"
    printf '%s\n\n' "$REVIEW_BODY"
    printf '%s\n' "$RULE"
    printf 'This review'\''s content is now in your context. Per .claude/rules/00-critical.md\n'
    printf '"Never Merge PRs Without Completed CI" #3:\n\n'
    printf '  - If the review is LGTM with no actionable items, retry the same merge\n'
    printf '    command — it will proceed (this comment-id is now acked).\n'
    printf '  - If the review surfaced a substantive finding (post-autosquash review\n'
    printf '    can differ from pre-autosquash), report it to the user and ask whether\n'
    printf '    to proceed, fix, or backlog.\n\n'
    printf 'RE-DERIVE THE NUMBERS: before retrying the merge, re-run the command behind\n'
    printf 'every count, ratio, and enumeration in the PR body and commit message and\n'
    printf 'fix what moved — self-reported numbers are written once at peak confidence\n'
    printf 'and never re-read, and reviewers have caught stale ones on most PRs that\n'
    printf 'carried them (/tzurot-git-workflow, closing-reference procedure).\n\n'
    if [ "${ORIGIN_HITS:-0}" -gt 0 ] 2>/dev/null; then
        printf '⚠ ORIGIN-LANGUAGE DETECTED (%s matching line(s)). This review scopes at\n' "$ORIGIN_HITS"
        printf 'least one finding as pre-existing / not-a-regression. Origin is NOT a\n'
        printf 'correctness verdict (/tzurot-review-response, rule 2). Before\n'
        printf 'retrying the merge, give each such finding a merits disposition in your\n'
        printf 'user-facing summary: fix now / backlog entry with promote-when /\n'
        printf 'correct-as-is WITH the technical reason. "Pre-existing" may not be the\n'
        printf 'operative reason.\n\n'
    fi
    if [ "$RELEASE_DUE" = 1 ]; then
        print_release_block
    fi
    printf 'Do NOT bypass this gate by editing the ack file. The gate'\''s purpose is to\n'
    printf 'ensure the latest review is in context at merge time — not an obstacle to\n'
    printf 'be routed around.\n'
    printf '%s\n' "$RULE"
} >&2

# Now write the ack. Fail-open if the write itself fails (disk full, /tmp
# readonly, permission race): blocking on retry would infinite-loop because
# the next call would also fail to write, never see the ack, and re-block.
# The review has already been injected to stderr, so the agent has seen the
# content — the trade-off is "this PR's gate effectively no-ops until the
# system-fault is fixed" rather than "agent stuck blocked indefinitely."
# Consistent with the script's other fail-open paths (no review present,
# malformed API response).
if ! echo "$ACK_KEY" >>"$ACK_FILE" 2>/dev/null; then
    printf 'WARNING: pr-merge-review-check ack write failed (%s) — allowing merge to avoid infinite block; investigate /tmp writability\n' "$ACK_FILE" >&2
    exit 0
fi
# Ack the release reminder too when it was just shown, so a later call on this
# PR (a fresh review re-arming the gate, or a no-review path) does not repeat
# it. Best-effort: a failure here costs a duplicate reminder, never a block.
if [ "$RELEASE_DUE" = 1 ]; then
    echo "$RELEASE_KEY" >>"$ACK_FILE" 2>/dev/null || true
fi
chmod 600 "$ACK_FILE" 2>/dev/null || true

exit 2
