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
    .claude/hooks/cwd-drift-guard.sh   (strip_quoted only — it blocks too, but
                                        for the lower-stakes drift-warning case,
                                        so it keeps the substitution-blind
                                        behaviour)

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


def strip_quoted(text):
    """Replace each quoted span with `S`. Returns None if a quote is unclosed."""
    out = []
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote is None:
            if ch == "\\" and i + 1 < len(text):
                # Outside quotes bash lets a backslash escape ANY character, and
                # the escaped character keeps its own value — `t\ail` runs tail.
                # Collapsing every escape to a placeholder therefore HID command
                # names from the scan: measured, a commit piped into that
                # spelling of tail exited 0 while bash ran it as tail exactly as
                # written. Emit the real character instead; only an escaped
                # QUOTE needs a placeholder, so it cannot open a span.
                nxt = text[i + 1]
                if nxt == "\n":
                    # A LINE CONTINUATION, which is not an escape at all: bash
                    # removes the backslash AND the newline and splices the two
                    # lines with nothing between them. Emitting a placeholder
                    # here fabricated a non-whitespace token between two words
                    # bash runs adjacently, and every target regex requires
                    # `\s+` adjacency — measured, `git \<newline>  commit -m x`
                    # stripped to `git Q  commit` and detection returned False,
                    # so a perfectly ordinary multi-line commit slipped the
                    # blocking guard. Dropping both characters reproduces the
                    # splice exactly, including the case that must NOT match:
                    # `git\<newline>commit` splices to `gitcommit`, one token.
                    i += 2
                    continue
                # Re-emit the escaped character — EXCEPT the ones that are
                # syntax to the splitters in the calling hooks. An escaped `|`
                # is a literal pipe character in an argument, not a pipeline
                # operator, but once the backslash is gone `segment.split("|")`
                # cannot tell the difference: measured, `git commit -m x\|tail`
                # blocked as though the commit were piped into tail, when bash
                # runs no pipeline at all. Same reasoning for the chain
                # separators. A placeholder keeps the character from acting as
                # syntax while preserving the token boundary.
                #
                # No `\n` in that set: the branch above consumes every
                # backslash-newline, so it could never reach here — and a
                # placeholder would be wrong for it anyway. bash DELETES that
                # pair rather than making it literal, which is exactly the
                # distinction the two branches encode.
                out.append("Q" if nxt in "\"'|&;" else nxt)
                i += 2
                continue
            if ch in "\"'":
                quote = ch
                out.append("S")
            else:
                out.append(ch)
        elif quote == '"':
            if ch == "\\" and i + 1 < len(text):
                i += 2
                continue
            if ch == quote:
                quote = None
        else:
            # Inside single quotes there are no escapes; only the closing
            # quote ends the span.
            if ch == quote:
                quote = None
        i += 1
    return None if quote is not None else "".join(out)


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
_HEREDOC_OPENER = re.compile(r"(?<!<)<<(-?)\s*(['\"]?)(\w+)\2")


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
        match = _HEREDOC_OPENER.search(text, pos)
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
