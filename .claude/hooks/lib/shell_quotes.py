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

CONSUMERS
---------
    .claude/hooks/lossy-pipe-guard.sh
    .claude/hooks/develop-code-commit-guard.sh
    .claude/hooks/cwd-drift-guard.sh

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
