#!/bin/bash
# Bare-token approval reminder (UserPromptSubmit).
#
# Fires when the user's whole message is a short approval / decline / selection
# token — "sure", "A", "yes and yes", "approve both". Those replies carry a
# decision whose BINDING lives only in the assistant's preceding menu, so a
# later reader (or a post-compaction session) sees an unreadable "sure" with no
# record of what it chose. 09-interaction-style.md § "An Escalation Is One Named
# Question Plus a Recommendation" requires restating the binding; this hook is
# the mechanical trigger for it.
#
# Deliberately narrow: anything with a newline, anything over 60 characters, and
# anything starting with `/` is left alone. A reminder that fires on ordinary
# prose trains the reader to skim past it.
#
# Patterns are plain POSIX ERE (no PCRE-only constructs) because some dev
# machines have ugrep standing in for grep — see the note at skill-eval.sh:81-90.

set -uo pipefail

INPUT=$(cat)

# Fail open when jq is missing — checked BEFORE the jq invocation it guards.
command -v jq >/dev/null 2>&1 || exit 0

PROMPT=$(jq -r '.prompt // empty' <<<"$INPUT" 2>/dev/null || echo "")

[ -n "$PROMPT" ] || exit 0

# Trim leading and trailing whitespace.
PROMPT="${PROMPT#"${PROMPT%%[![:space:]]*}"}"
PROMPT="${PROMPT%"${PROMPT##*[![:space:]]}"}"

[ -z "$PROMPT" ] && exit 0

# Slash command — the harness owns it, not a reply to anything we asked.
case "$PROMPT" in
    /*) exit 0 ;;
esac

# Multi-line means the message carries its own content; a bare token does not.
case "$PROMPT" in
    *$'\n'*) exit 0 ;;
esac

# Length ceiling. A token plus courtesy fits easily; a sentence does not.
if [ "${#PROMPT}" -gt 60 ]; then
    exit 0
fi

# --- Shapes -----------------------------------------------------------------
# (a) single approval / decline token
TOKENS='yes|yep|yeah|sure|ok|okay|approved|approve|confirmed|confirm|proceed|lgtm|go ahead|do it|ship it|sounds good|works for me|no|nope|skip|decline|either|both|neither'

# (b) compound token chains — "yes and yes", "yes and no"
CHAIN='(yes|no|sure)( and (yes|no|sure))+'

# (c) bare option selectors — "A", "1", "the second one". Ceiling is a scope
# choice, not an oversight: menus here run 2-4 options (AskUserQuestion's max),
# so A-D / 1-9 / first-fourth covers the real shapes; a wider range would start
# matching prose fragments.
SELECTOR='[a-d]|[1-9]|(option |the )?(first|second|third|fourth)( one)?'

# (d) content-free recommendation approvals. Single-quoted strings can't hold an
# apostrophe, so `let's` is assembled around $APOS.
APOS="'"
RECS="(i )?(approve|go with|follow)( your| the)? recommendations?|let${APOS}?s go with (your|the) recommendations?|your recommendation sounds good( to me)?|approve both|you can merge|(merge )?approval granted"

# Trailing punctuation and one courtesy suffix are allowed on every shape, in
# either order around the courtesy word ("Sounds good, thanks!").
SUFFIX='[.!,]*( (please|thanks|thank you))?[.!,]*'

PATTERN="^(${TOKENS}|${CHAIN}|${SELECTOR}|${RECS})${SUFFIX}\$"

# printf, not echo: a prompt that IS a flag-shaped token ("-n") would vanish
# into bash's builtin echo as an option rather than data.
if ! printf '%s\n' "$PROMPT" | grep -qiE "$PATTERN"; then
    exit 0
fi

cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BARE-TOKEN APPROVAL: the user's reply is a short approval/selection token.
Per 09-interaction-style.md, restate what it binds at the top of your reply
("<token> = <the specific choice>") and record the decision to a durable
surface if it outlives this session. A bare token with no recorded menu is
an unreadable decision after compaction.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
