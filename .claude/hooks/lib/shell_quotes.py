"""Shell quote stripping, shared by every hook that has to scan a command line.

WHY THIS IS A MODULE AND NOT THREE COPIES
-----------------------------------------
Three hooks need the same thing: replace each quoted span in a command string
with a placeholder, so that argument CONTENT (a commit message, a `-m` body, an
example command quoted in prose) cannot influence a structural scan of the
command. Each of them had its own copy, and the copies had already diverged —
lossy-pipe-guard's was fixed while develop-code-commit-guard's and
cwd-drift-guard's kept the bug for another PR.

The bug is worth stating precisely, because the naive version looks obviously
correct and is not. Stripping single-quoted spans and double-quoted spans as two
INDEPENDENT passes pairs raw quote characters with no notion of which quote type
is already open, so an ordinary apostrophe inside a double-quoted argument is
read as a real delimiter and pairs with a later one:

    git commit -m "it's" | grep "isn't"     MEASURED: the guard exited 0
    echo "it's" && git commit -m "won't"    MEASURED: strips to `echo S`

In the first, the apostrophes in `it's` and `isn't` pair, erasing the pipe and
`grep` between them. In the second, they erase the entire `git commit`. Both are
ordinary English in a commit message, not adversarial input.

Swapping the pass order only mirrors the bug — a literal `"` inside a
single-quoted argument then pairs the same naive way — so the two-pass strategy
has no correct ordering. It needs STATE, which is what this scanner has.

FAILURE DIRECTION
-----------------
An UNTERMINATED quote strips NOTHING (returns None). Dropping to end-of-text
would delete a real invocation and produce a bypass; keeping the text merely
over-arms the caller, and over-arming is the recoverable direction for all three
consumers.

WHAT strip_quoted DOES NOT SEE
------------------------------
A quoted span is replaced WHOLE, which means a command substitution nested
inside one is erased along with it — while bash still executes the inner
command. Measured, all three forms ran the inner commit:

    echo "$(git commit -m x)"   ->  echo S   (the invocation is gone)
    echo "`git commit -m x`"    ->  echo S
    echo $(git commit -m x)     ->  intact   (unquoted survives the strip)

The even quote count means the scan closes cleanly and the caller never
reaches the unterminated-quote safe direction above. `substitution_spans`
exists for that: it reads the substitution CONTENTS straight out of the raw
text so a caller can scan them as commands in their own right, which is what
bash treats them as. `strip_heredoc_bodies` is its companion — without it a
span holding the repo's canonical `$(cat <<'EOF' … EOF)` commit message would
be scanned including the message body.

CONSUMERS
---------
    .claude/hooks/lossy-pipe-guard.sh
    .claude/hooks/develop-code-commit-guard.sh
    .claude/hooks/board-commit-branch-gate.sh   (strip_quoted_indexed PLUS
                                        wrapped_command_strings — deliberately
                                        NOT executed_segments. This consumer
                                        re-scans each unwrapped inner string
                                        with its OWN indexed view, at every
                                        level, because it has to resolve add
                                        pathspecs back to real paths, which
                                        executed_segments' pre-stripped
                                        segments cannot give it.)
    .claude/hooks/cwd-drift-guard.sh   (strip_quoted for its drift checks, plus
                                        executed_segments for its tracker-write
                                        refusal — it stays substitution-blind
                                        either way, that being the lower-stakes
                                        drift-warning case)

A THIRD THING strip_quoted DOES NOT SEE, distinct from the substitution case
above: a WRAPPER's string argument. `bash -c "…"`, `sh -c "…"` and `eval "…"`
hand their argument to a shell as a command, so the strip that correctly makes
`echo "…"` inert erases a real invocation. There are two answers, depending on
what the caller needs: `executed_segments` for a caller that just wants
scan-ready segments, `wrapped_command_strings` for a caller that needs the
raw inner string to scan its own way. Both are separate functions rather than
a change to strip_quoted because the distinction is not about quoting at all
— it is about which COMMANDS execute their arguments.

Behaviour is pinned by packages/tooling/src/dev/shellQuotes.test.ts, which runs
this module directly, plus each consumer's own .probe.sh.

A hook that cannot import this module fails OPEN (its python exits non-zero and
the hook allows the command). That direction is deliberate — a PreToolUse hook
that blocked every Bash call on an infrastructure error would be unusable — but
it does mean a missing lib silently disarms a blocking guard at runtime. The
backstop is CI, not runtime: every consumer's probe exercises a case that only
passes when the import works, and `guard:hook-probes` runs them in the lint job
and in `pnpm quality`.
"""

import re


def _scan_events(text):
    """Walk `text` once with bash's quote state machine, yielding one event per
    unit of syntax. Every quote-aware reader in this module is built on this, so
    the state machine the module docstring argues for exists exactly once.

    Events, as `(kind, payload)`:

        ("char", c)          an ordinary character outside quotes
        ("escape", c)        a backslash-escaped character outside quotes;
                             payload is the character bash would produce
        ("continuation", "") a backslash-newline outside quotes, which bash
                             deletes entirely rather than making literal
        ("quoted", value)    a COMPLETE quoted span, emitted at the closing
                             quote; payload is the span's VALUE — delimiters
                             removed and escapes resolved as bash resolves them
                             for that quote type
        ("unterminated", "") the text ended with a quote still open; always the
                             last event when it appears

    A quoted span's inner characters produce no events of their own — a reader
    that wants them reads the `quoted` payload. `strip_quoted` discards that
    payload (a span is a placeholder to it); the readers that run a span's
    contents as a command need the value, which is why it is resolved here
    rather than left raw.

    Inside SINGLE quotes nothing escapes and the value is verbatim. Inside
    DOUBLE quotes a backslash is literal EXCEPT before `$`, a backtick, `"` or
    `\\` (where it is removed and the character kept, so `"a\\"b"` stays one
    span) and before a newline (where both are removed). That is bash's rule,
    argued from its documented quoting behaviour rather than a runtime repro.
    """
    quote = None
    span = []
    i = 0
    while i < len(text):
        ch = text[i]
        if quote is None:
            if ch == "\\" and i + 1 < len(text):
                nxt = text[i + 1]
                yield ("continuation", "") if nxt == "\n" else ("escape", nxt)
                i += 2
                continue
            if ch in "\"'":
                quote = ch
                span = []
            else:
                yield ("char", ch)
        elif quote == '"':
            if ch == "\\" and i + 1 < len(text):
                nxt = text[i + 1]
                if nxt == "\n":
                    pass
                elif nxt in '$`"\\':
                    span.append(nxt)
                else:
                    span.append(ch)
                    span.append(nxt)
                i += 2
                continue
            if ch == quote:
                yield ("quoted", "".join(span))
                quote = None
            else:
                span.append(ch)
        else:
            # Inside single quotes there are no escapes; only the closing
            # quote ends the span.
            if ch == quote:
                yield ("quoted", "".join(span))
                quote = None
            else:
                span.append(ch)
        i += 1
    if quote is not None:
        yield ("unterminated", "")


def strip_quoted(text):
    """Replace each quoted span with `S`. Returns None if a quote is unclosed."""
    out = []
    for kind, payload in _scan_events(text):
        if kind == "char":
            out.append(payload)
        elif kind == "quoted":
            # Emitted at the closing quote rather than the opening one. The
            # span's own characters produce no output either way, so the
            # placeholder lands in the same position in the result.
            out.append("S")
        elif kind == "escape":
            # Outside quotes bash lets a backslash escape ANY character, and
            # the escaped character keeps its own value — `t\ail` runs tail.
            # Collapsing every escape to a placeholder therefore HID command
            # names from the scan: measured, a commit piped into that
            # spelling of tail exited 0 while bash ran it as tail exactly as
            # written. Emit the real character instead — EXCEPT the ones that
            # are syntax to the splitters in the calling hooks. An escaped `|`
            # is a literal pipe character in an argument, not a pipeline
            # operator, but once the backslash is gone `segment.split("|")`
            # cannot tell the difference: measured, `git commit -m x\|tail`
            # blocked as though the commit were piped into tail, when bash
            # runs no pipeline at all. Same reasoning for the chain separators
            # and for a quote, which must not be able to open a span. A
            # placeholder keeps the character from acting as syntax while
            # preserving the token boundary.
            #
            # No `\n` in that set: a backslash-newline arrives as its own
            # `continuation` event and never reaches here — and a placeholder
            # would be wrong for it anyway. bash DELETES that pair rather than
            # making it literal, which is exactly the distinction the two
            # events encode.
            out.append("Q" if payload in "\"'|&;" else payload)
        elif kind == "unterminated":
            return None
        # A `continuation` contributes nothing: bash removes the backslash AND
        # the newline and splices the two lines with nothing between them.
        # Emitting a placeholder here fabricated a non-whitespace token between
        # two words bash runs adjacently, and every target regex requires `\s+`
        # adjacency — measured, `git \<newline>  commit -m x` stripped to
        # `git Q  commit` and detection returned False, so a perfectly ordinary
        # multi-line commit slipped the blocking guard. Dropping both
        # characters reproduces the splice exactly, including the case that
        # must NOT match: `git\<newline>commit` splices to `gitcommit`, one
        # token.
    return "".join(out)


# Private-use-area codepoints (never emitted by ordinary command text), so a
# placeholder cannot collide with characters a caller might legitimately be
# scanning. "Never emitted by ordinary text" is not the same as "cannot
# appear", though, so `strip_quoted_indexed` REFUSES any input that already
# contains either codepoint: a literal one therefore never reaches a view or
# an index count at all. In a view a stray occurrence is indistinguishable
# from a real placeholder, and a caller that locates a token's values by
# COUNTING placeholders before that token then reads a shifted index for every
# LATER token — not merely a wrong value in the token the stray sits in, which
# is the narrower case this comment used to reason about.
#
# `resolve_placeholders` still leaves a SURPLUS placeholder in the token
# rather than raising. Behind that refusal it is defence in depth, for a
# caller that builds its own view instead of taking one from
# `strip_quoted_indexed`: the token then fails the caller's allowlist match
# and the caller OVER-reports a non-allowlisted path. That is the fail-open
# direction board-commit-branch-gate.sh already documents for scan trouble: a
# widened file set can only ever make a commit PASS, never wrongly block one.
# Not assumed — still pinned by the surplus-placeholder case in
# shellQuotes.test.ts.
QUOTED_SPAN = "\ue000"
ESCAPED_BLANK = "\ue001"


def strip_quoted_indexed(text):
    """Like `strip_quoted`, but RESOLVABLE: each quoted span becomes
    `QUOTED_SPAN` and each backslash-escaped space/tab outside quotes becomes
    `ESCAPED_BLANK`, so a caller that splits the view on whitespace keeps
    every bash word whole and can map each placeholder back to its value.

    Returns `(view, values)` with `values[i]` the value of the i-th quoted
    span in `text` order. `None` on TWO conditions: an unterminated quote,
    exactly as `strip_quoted`; and a `text` that ALREADY contains
    `QUOTED_SPAN` or `ESCAPED_BLANK`, for the reason in the comment above
    them. Escaped separators/quotes still become `Q` — same set, same reason
    as `strip_quoted`; a continuation still contributes nothing.

    One deliberate difference from `strip_quoted`, which emits a REAL space
    for an escaped blank: here it is a non-whitespace placeholder, so a regex
    that requires `\\s` between two words no longer matches across it. That
    matches bash, where `git\\ commit` is ONE word and runs no commit — the
    old literal space was an over-arm. Pinned by "an escaped blank between
    git and commit is one word, not a commit" in
    .claude/hooks/board-commit-branch-gate.probe.sh.

    A second function rather than a change to `strip_quoted`: `strip_quoted`'s
    `S` output is pinned by packages/tooling/src/dev/shellQuotes.test.ts and
    read by three other hooks, so its output shape is a contract this
    function must not disturb.
    """
    # A private-use codepoint already in the INPUT is indistinguishable from a
    # placeholder in the view and would shift every LATER token's value index,
    # so the caller gets the same signal an unterminated quote gives it and
    # falls back to the raw text.
    if QUOTED_SPAN in text or ESCAPED_BLANK in text:
        return None
    out = []
    values = []
    for kind, payload in _scan_events(text):
        if kind == "char":
            out.append(payload)
        elif kind == "quoted":
            out.append(QUOTED_SPAN)
            values.append(payload)
        elif kind == "escape":
            if payload in "\"'|&;":
                out.append("Q")
            elif payload in " \t":
                out.append(ESCAPED_BLANK)
            else:
                out.append(payload)
        elif kind == "unterminated":
            return None
    return "".join(out), values


def resolve_placeholders(token, values, next_index):
    """Return `(resolved, index)`: `token` with each `QUOTED_SPAN` replaced by
    `values[next_index]`, `values[next_index + 1]`, … in order, and each
    `ESCAPED_BLANK` replaced by a real space; `index` is `next_index` advanced
    past the last value consumed.

    The caller finds `next_index` for a token by counting `QUOTED_SPAN`
    characters in the view BEFORE that token's start.

    A surplus placeholder — more than `len(values) - next_index` remaining —
    is left in place rather than raising: see the module comment on
    `QUOTED_SPAN` for why leaving it is the correct fail-open direction here.
    """
    out = []
    for ch in token:
        if ch == QUOTED_SPAN:
            if next_index < len(values):
                out.append(values[next_index])
                next_index += 1
            else:
                out.append(ch)
        elif ch == ESCAPED_BLANK:
            out.append(" ")
        else:
            out.append(ch)
    return "".join(out), next_index


def substitution_spans(text):
    """Return the CONTENT of every `$(...)` and backtick span in `text`.

    Read from the RAW text, DELIBERATELY IGNORING quote context. A span inside
    DOUBLE quotes really is executed by bash, so it must be extracted; a span
    inside SINGLE quotes is inert prose and is extracted anyway. That second
    case is a known OVER-ARM, accepted rather than fixed: the callers are
    blocking guards where over-arming costs one re-run (or the documented
    escape hatch) while under-arming is an unreviewed commit. Pinned by
    "a span inside single quotes is extracted anyway (accepted over-arm)" in
    packages/tooling/src/dev/shellQuotes.test.ts.

    KNOWN UNDER-ARM, same file, pinned by "a quoted `)` inside a span ends it
    early": `)` is counted structurally, so `$(echo ")" && git commit)` yields
    only `echo "` and anything after that paren escapes the scan. Modelling
    quotes inside the span would mean a second scanner with its own failure
    directions; the threat model here is habitual command shapes, matching the
    boundary the consuming hooks already state.

    Nesting is handled by PAREN DEPTH and nothing else: `$(a $(b))` yields the
    single span `a $(b)`, inner text verbatim. The callers run a regex over the
    content, and a regex sees the inner text just as well inside the outer —
    so recursing would only produce duplicate hits.

    An UNTERMINATED span runs to end of text. Unlike strip_quoted's
    strip-nothing rule, that direction is safe here: this function only ADDS
    text for the caller to scan, so an over-long span can over-arm and can
    never hide an invocation.
    """
    spans = []
    i = 0
    end_of_text = len(text)
    while i < end_of_text:
        ch = text[i]
        if ch == "\\" and i + 1 < end_of_text:
            # An escaped `$` or backtick opens nothing.
            i += 2
            continue
        if ch == "$" and i + 1 < end_of_text and text[i + 1] == "(":
            j = i + 2
            depth = 1
            while j < end_of_text:
                if text[j] == "\\" and j + 1 < end_of_text:
                    j += 2
                    continue
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            if j >= end_of_text:
                spans.append(text[i + 2 :])
                break
            spans.append(text[i + 2 : j])
            i = j + 1
            continue
        if ch == "`":
            j = i + 1
            while j < end_of_text:
                if text[j] == "\\" and j + 1 < end_of_text:
                    j += 2
                    continue
                if text[j] == "`":
                    break
                j += 1
            if j >= end_of_text:
                spans.append(text[i + 1 :])
                break
            spans.append(text[i + 1 : j])
            i = j + 1
            continue
        i += 1
    return spans


# `(?<!<)` keeps a here-string (`<<<word`) from reading as a heredoc opener:
# its trailing `<` plus a bare word matches the same characters, and the marker
# then never terminates, so the whole remainder of the span would be dropped.
#
# The marker is `\w+`, deliberately WIDER than pr-merge-review-check.sh's own
# stripper (`[A-Za-z_][A-Za-z_0-9]*`): bash accepts a digit-leading delimiter
# (`cat <<1EOF`), and a wider marker over-strips, which only ever removes
# candidate text a caller would scan — the recoverable direction here. Each
# hook strips the heredoc forms its own matching cares about (module docstring),
# so the two need not agree.
#
# PUBLIC, unlike the other module-private names: lossy-pipe-guard.sh has to
# REJOIN an emptied heredoc onto its opener line, and the opener half of that
# substitution is this same pattern. Spelling it out a second time in the hook
# is exactly the divergence this module exists to prevent — the copy there was
# written without the here-string lookbehind above and false-blocked a
# here-string followed by a piped command, so the hook composes from this name
# instead. Two consequences for anyone editing the pattern: the group NUMBERING
# (1 = the `-` indent flag, 2 = the quote character, 3 = the marker) is part of
# the exported contract, because that hook's replacement template reconstructs
# an opener from those groups; and both consumers are pinned by the heredoc and
# here-string cases in lossy-pipe-guard.probe.sh, which is where a group
# renumbering would surface.
HEREDOC_OPENER = re.compile(r"(?<!<)<<(-?)\s*(['\"]?)(\w+)\2")


def strip_heredoc_bodies(text):
    """Return `text` with every heredoc BODY removed, terminator line included.

    A QUOTED-delimiter heredoc body (`<<'EOF'` / `<<"EOF"`) is DATA — bash
    executes no word in it however command-shaped it looks. The companion to
    `substitution_spans`: the repo's canonical commit form is
    `git commit -m "$(cat <<'EOF' … EOF)"`, so a caller scanning that span would
    otherwise scan the commit MESSAGE, and a message discussing git commit
    habits would arm a blocking guard. Pinned by the strip_heredoc_bodies cases
    in packages/tooling/src/dev/shellQuotes.test.ts and by "heredoc BODY inside
    a span is not a commit" in .claude/hooks/develop-code-commit-guard.probe.sh.

    An UNQUOTED delimiter (`<<EOF`) is the one exception to "body is data": bash
    performs command/parameter substitution inside it exactly as in a
    double-quoted string, so a genuinely-executing `$(git …)` there is stripped
    as if inert — an accepted UNDER-arm. It matches what the guards' own
    top-level heredoc collapse already does, needs deliberate nested
    construction to reach, and sits inside the habitual-shapes threat model the
    consumers state; not verified against a runtime repro, argued from bash's
    documented expansion rules.

    Handles `<<MARKER`, `<<'MARKER'`, `<<"MARKER"` and the `<<-` indent form.
    The terminator must be the whole line; leading whitespace is tolerated only
    for `<<-`, matching bash.

    KNOWN LIMITATION, matching the sibling `strip_heredocs` in
    pr-merge-review-check.sh: only the FIRST opener on a line is recognized.
    Bash allows two on one line (`cmd <<A <<B` reads body A then body B), but
    search resumes past A's terminator, so B's body is left un-stripped. Fails
    SAFE — an un-stripped body only ADDS text a guard scans, which can only
    over-block, never hide a target. Pinned by "second heredoc opener on a line
    leaves its body" in shellQuotes.test.ts.

    An UNTERMINATED heredoc KEEPS the text after the opener rather than dropping
    it — the same over-arm direction as the sibling `strip_heredocs` in
    pr-merge-review-check.sh, and for the same reason. `substitution_spans_matching`
    hands this the WHOLE raw command, not one span's content, and the opener
    regex is quote-blind: a `<<WORD`-shaped string sitting inside an earlier
    quoted argument with no matching terminator line anywhere later would, under
    a drop-to-end rule, silently truncate a REAL `$(git commit …)` span that
    comes after it — a measured bypass of both blocking guards. Keeping the tail
    can only ADD text a guard scans (over-block, recoverable); dropping it can
    hide a target (a bypass, the one direction this must never take). Pinned by
    "a target after an unterminated heredoc opener still matches" in
    shellQuotes.test.ts and by the equivalent probe cases.
    """
    out = []
    pos = 0
    while True:
        match = HEREDOC_OPENER.search(text, pos)
        if match is None:
            out.append(text[pos:])
            return "".join(out)
        # Keep the redirection operator and the rest of the line carrying it;
        # only what the operator INTRODUCES is data.
        out.append(text[pos : match.end()])
        newline = text.find("\n", match.end())
        if newline == -1:
            out.append(text[match.end() :])
            return "".join(out)
        out.append(text[match.end() : newline + 1])
        indent = "[ \t]*" if match.group(1) == "-" else ""
        terminator = re.compile(
            r"^" + indent + re.escape(match.group(3)) + r"[ \t]*$", re.M
        )
        end = terminator.search(text, newline + 1)
        if end is None:
            # Unterminated: keep everything after the opener line (over-arm)
            # instead of dropping it — see the docstring for the bypass this
            # closes. Only the body of a TERMINATED heredoc is inert data.
            out.append(text[newline + 1 :])
            return "".join(out)
        pos = end.end()


def substitution_spans_matching(raw_text, predicate):
    """True if any command substitution in `raw_text`, cleaned as bash sees it,
    satisfies `predicate` (a text -> bool test).

    Both blocking guards need the identical thing — scan each `$(…)`/backtick
    span for their own target — and had the same three-step loop copy-pasted;
    this module exists BECAUSE three copies of quote logic diverged once, so the
    loop lives here rather than in each hook.

    The cleaning mirrors what a guard already does to the command itself, in the
    same order:

    1. strip heredoc bodies from the WHOLE raw command FIRST, so a `$(git …)`
       sitting in inert heredoc DATA is gone before extraction and cannot be
       pulled out as a span (a per-span strip cannot see it — the extracted span
       carries no heredoc marker). This is what keeps a documented bypass
       example inside a heredoc'd commit message from false-blocking.
    2. extract the substitution spans that remain.
    3. strip_quoted each span, so a quoted argument that merely MENTIONS the
       target (`$(gh pr comment --body "…git commit…")`) is inert prose. None
       means an unbalanced quote inside the span; fall back to the raw span so a
       broken quote state over-arms rather than escaping.

    Pinned by the substitution-span probe cases in
    develop-code-commit-guard.probe.sh and lossy-pipe-guard.probe.sh (the
    heredoc-body, single-quote-over-arm, and quoted-prose cases).
    """
    for span in substitution_spans(strip_heredoc_bodies(raw_text)):
        scanned = strip_quoted(span)
        if predicate(scanned if scanned is not None else span):
            return True
    return False


# A wrapper is a command whose STRING ARGUMENT bash then executes as a command
# in its own right. `eval` takes it directly; the shells take it after `-c`.
_WRAPPER_SHELLS = ("bash", "sh", "zsh")

# `-c` as bash accepts it, including a short-option cluster ending in it
# (`bash -lc "…"`, `sh -ec "…"`). Matching the cluster over-arms — a flag
# spelled `-abc` that is not really `-c` would still have its next word
# scanned — which only ever ADDS text to scan.
_DASH_C = re.compile(r"^-[A-Za-z]*c$")

# Characters that end a word AND a command, so the next word is at command
# position. `(` is included because `(cmd)` and `$(cmd)` both start one.
_WORD_SEPARATORS = ";&|\n()"

# A leading env-assignment word (`VAR=value`) does NOT consume command
# position: bash runs `VAR=1 bash -c "…"` with the assignment applied to the
# wrapper, so the wrapper is still a wrapper and its string argument is still
# a command. Reading the assignment word itself as the command name hid every
# wrapper standing behind one — measured, `FOO=1 bash -c "git add tracker/ &&
# git commit -m x"` yielded no segments at all, so a blocking consumer saw
# nothing to assess. Spelled to match the assignment class the consuming
# hooks' own bypass patterns already use (`ASSIGNMENTS` in
# board-commit-branch-gate.sh).
_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

# Recursion bound for wrappers nested inside wrappers, matching the intent of
# `extract`'s cap in pr-merge-review-check.sh: a fixed ceiling so a pathological
# input cannot recurse without end. Depth 0 is the command itself, so three
# levels of wrapper get unwrapped and a fourth is left as the placeholder text
# the caller's own quote strip produced for it — an under-arm at a nesting
# depth no habitual command shape reaches.
MAX_WRAPPER_DEPTH = 3


def _words(text):
    """Split `text` into bash words, with `None` marking a command separator.

    Each word is its VALUE as bash would compute it — quotes removed, escapes
    resolved, adjacent pieces concatenated — because that value is what bash
    runs and what a wrapper hands to a new shell. `"pnpm tracker task create"`
    and `pnpm\\ tracker\\ task\\ create` are the same word here, as they are to
    bash.

    Deliberately NOT a general tokenizer: it knows quoting (via the shared
    scanner) and unquoted whitespace and separators, and nothing else.
    Redirections, assignments, and expansions are left as ordinary words —
    `wrapped_command_strings` only needs to recognize a command name, a flag,
    and the word after it.

    An unterminated quote ends the scan where it opens, so the trailing text is
    dropped. That is the same direction `strip_quoted` takes on unbalanced
    quotes, and the caller keeps the whole quote-stripped command as its first
    segment regardless, so nothing a balanced command contains can be hidden.
    """
    words = []
    value = []
    started = False

    def flush():
        if started:
            words.append("".join(value))

    for kind, payload in _scan_events(text):
        if kind == "quoted" or kind == "escape":
            # A quoted span starts a word even when empty: `cmd ""` passes one
            # empty argument, and dropping it would shift the `-c` lookahead.
            if not started:
                started = True
                value = []
            value.append(payload)
        elif kind == "char":
            if payload in " \t":
                flush()
                started = False
                value = []
            elif payload in _WORD_SEPARATORS:
                flush()
                started = False
                value = []
                words.append(None)
            else:
                if not started:
                    started = True
                    value = []
                value.append(payload)
        elif kind == "unterminated":
            break
        # A `continuation` splices the lines with nothing between them, so it
        # neither ends the current word nor contributes to it.
    flush()
    return words


def wrapped_command_strings(text):
    """Return the argument of every wrapper invocation in `text`, unquoted.

    A wrapper is recognized only at COMMAND POSITION — the start of `text` or
    just after a separator — so `echo bash -c "…"` yields nothing: that `bash`
    is an argument being printed, not a shell being run. A leading path is
    tolerated (`/bin/sh -c "…"`), because it is the same program.

    `eval` concatenates its arguments with spaces and executes the result;
    each argument is returned separately instead. For the single-argument form
    that is exact, and for the multi-argument form it under-arms only a target
    split ACROSS argument boundaries — deliberate construction, outside the
    habitual-shapes threat model this module's consumers state.

    PUBLIC because a second caller needs it directly: board-commit-branch-gate.sh
    wants the RAW, unquoted inner string rather than `executed_segments`' already
    quote-stripped segments — it builds its own resolvable `strip_quoted_indexed`
    view per level so a quoted pathspec inside a wrapper still resolves back to
    a real path, which a pre-stripped segment cannot supply.

    A leading env-assignment word (`VAR=value`, one or more) is skipped rather
    than treated as the command: bash still runs the WORD AFTER it at command
    position, so `FOO=1 bash -c "…"` is still a wrapper invocation.
    """
    words = _words(text)
    found = []
    at_command_position = True
    i = 0
    while i < len(words):
        word = words[i]
        if word is None:
            at_command_position = True
            i += 1
            continue
        if at_command_position:
            # Does NOT clear `at_command_position` — the assignment prefixes
            # the NEXT word, which is the command bash actually runs.
            if _ASSIGNMENT.match(word):
                i += 1
                continue
            name = word.rsplit("/", 1)[-1]
            if name == "eval":
                i += 1
                while i < len(words) and words[i] is not None:
                    found.append(words[i])
                    i += 1
                continue
            if name in _WRAPPER_SHELLS:
                j = i + 1
                while j < len(words) and words[j] is not None:
                    if _DASH_C.match(words[j]):
                        if j + 1 < len(words) and words[j + 1] is not None:
                            found.append(words[j + 1])
                        break
                    j += 1
        at_command_position = False
        i += 1
    return found


def executed_segments(text):
    """Return every command text bash would EXECUTE from `text`, scan-ready.

    The first element is always `text` with its quoted spans stripped — what a
    structural scan has always read. Each further element is the argument of a
    wrapper invocation (`bash -c`, `sh -c`, `zsh -c`, `eval`), itself stripped
    the same way, recursively.

    WHY A SCAN NEEDS MORE THAN strip_quoted
    ---------------------------------------
    Stripping quoted spans is what makes `echo "pnpm tracker task create x"`
    inert: the argument is data the command prints, and letting its CONTENT
    decide a structural question is the bug this whole module exists for. But
    the same strip erases `bash -c "pnpm tracker task create x"`, where the
    identical characters are a command bash runs. The strip cannot tell those
    apart on its own — only knowing which commands EXECUTE a string argument
    can, which is what `wrapped_command_strings` supplies.

    A caller scans every returned segment, so a target anywhere in the chain is
    seen. `echo` is not a wrapper, so its argument stays a placeholder and the
    inert case above stays inert.

    WHAT THIS DOES NOT SEE
    ----------------------
    A wrapper whose argument is built rather than written — `bash -c "$CMD"`,
    `eval "$(…)"` — yields the placeholder or the substitution text, not the
    command that eventually runs. Nothing textual can resolve that; the
    consumers' threat model is habitual command shapes, and `substitution_spans`
    covers the substitution half for the callers that want it.

    Recursion stops at `MAX_WRAPPER_DEPTH`; see that constant.

    Pinned by the wrapper cases in packages/tooling/src/dev/shellQuotes.test.ts
    and by the wrapped-tracker-mutation fixtures in
    .claude/hooks/cwd-drift-guard.probe.sh.
    """
    return _executed_segments(text, 0)


def _executed_segments(text, depth):
    scanned = strip_quoted(text)
    # An unterminated quote strips NOTHING, so fall back to the raw text: for
    # every consumer that is the over-arming direction, the same one
    # `substitution_spans_matching` takes for a broken span.
    segments = [text if scanned is None else scanned]
    if depth >= MAX_WRAPPER_DEPTH:
        return segments
    for inner in wrapped_command_strings(text):
        segments.extend(_executed_segments(inner, depth + 1))
    return segments
