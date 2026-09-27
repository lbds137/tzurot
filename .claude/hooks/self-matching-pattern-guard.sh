#!/bin/bash
# PreToolUse hook: block a `pgrep -f` / `pkill -f` whose pattern is not the
# bracket form.
#
# `pgrep -f` / `pkill -f` matches against the FULL command line of every
# process, including the shell that is running the pgrep/pkill invocation
# itself. That shell's own cmdline contains the pattern text verbatim, so an
# unguarded pattern matches its own invocation. In a `while pgrep -f ... ; do
# sleep; done` wait loop the condition never goes false and the loop runs
# forever; with `pkill -f` it kills the session issuing the command. The
# bracket idiom (`pgrep -f '[p]attern'`) defeats this: the literal `[p]attern`
# text in the invoking shell's own cmdline does not match the regex
# `[p]attern`, because the character class consumes the leading letter.
#
# Detection is a pure-bash word scan (no python/jq body): split the command on
# whitespace and group the words into pgrep/pkill INVOCATIONS — a command word
# plus every word that follows it up to the next command separator. Each
# invocation is then tested as a SET, not a sequence: it blocks when it
# carries a full-cmdline flag (`-f`, `--full`, or a combined short-flag form
# like `-af`) AND none of its argument words open with the bracket idiom.
# Because the test is set membership, not position, ordering never matters —
# a value-taking option (`-u root`, `--signal TERM`) before or after the
# flag, an end-of-options `--`, and a `;` glued to the pattern word are all
# resolved by the same test. The bracket test checks EVERY argument word, not
# just "the one right after the flag" — safe because pgrep/pkill accept
# exactly one pattern (`pgrep foo bar` errors "only one pattern can be
# provided", exit 2), so a bracket-leading word can only be the pattern
# itself (or, absurdly, an option's value, which is fine to accept as safe).
#
# KNOWN OVER-BLOCK, accepted: this is a WORD scan, not a shell parse, so a
# `pgrep -f` appearing inside an `echo`, a quoted string, or a heredoc body is
# scanned exactly like a real invocation and blocks. For a blocking guard that
# costs one retry on the rare case where the text is prose rather than a real
# command, which is cheaper than teaching this hook to distinguish quoting
# context — the same trade lossy-pipe-guard.sh and develop-code-commit-guard.sh
# already accept in their own word/line scans.
#
# Tokenization: a substitution form ($(...), a backtick, a subshell paren, or
# a leading assignment) is recognized as an invocation start, and the word
# that closes it (a matching ) or backtick) closes the invocation the same way
# a trailing `;` does. A line boundary is a separator, splitting one invocation
# per line; a trailing backslash continuation joins the next line first, so
# `pgrep -f \` + newline + `'[p]attern'` still reads as one open invocation.
# A redirect operator (`>`, `2>`, `&>`, ...) also ends the argument set:
# everything after it names a file or heredoc delimiter, never the pattern.
#
# Literal recurrence: the bracket idiom only defeats the SHELL's own cmdline
# match, because the invoking shell's cmdline carries the bracketed text
# (`[p]attern`), not the bare literal (`pattern`). `pgrep -f`/`pkill -f` runs
# a substring regex search over the WHOLE cmdline of every process, so if
# that same literal ALSO occurs, unbracketed, anywhere else in the command
# text -- a `kill`/`rm`/`echo` target built from the same name later on the
# same line -- the invocation still self-matches there. For EVERY bracketed
# word, this hook derives the literal the documented idiom represents
# (`[p]attern` -> `pattern`; a single leading one-char class only -- anything
# more complex, a multi-char class or a missing close-bracket at position 2,
# is treated as un-derivable and contributes no literal, no extra block) and
# blocks when any derived literal occurs anywhere else in the full command
# text, reporting the first one found. A quoted pattern containing a space
# (`'[n]ode server.js'`) reaches the word scan split across multiple words --
# the scan has no quote awareness, so a bracket word that opened a quote but
# does not itself close it is likewise un-derivable and skipped: this check
# is a literal SUBSTRING search, an approximation of the tool's regex match
# that is exact for plain names and paths but not for a pattern containing
# regex metacharacters. The bracket idiom breaks contiguity inside its own
# word (`[f]oo` never contains the substring `foo`), so the search needs no
# special-casing to exclude the pattern word's own occurrence.
#
# Fixture check: run .claude/hooks/self-matching-pattern-guard.probe.sh after ANY edit.

set -uo pipefail

INPUT=$(cat)

# Raw-payload fast path: only decode JSON for a payload that could possibly
# carry a pgrep/pkill invocation. Mirrors the sibling guards' cheap-check-first
# ordering — the overwhelming majority of Bash calls exit here.
case "$INPUT" in
  *pgrep*|*pkill*) ;;
  *) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

GUARD_CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$GUARD_CMD" ] && exit 0

# `read -ra` consumes a single line, so a multi-line command needs its
# newlines turned into separators the word loop understands — collapsing to a
# bare space would splice line 2's words onto an invocation still open from
# line 1, letting a bracket word on line 2 rescue an unguarded pattern above.
# Join a trailing-backslash continuation first (keeps the invocation open
# across it), THEN turn every remaining newline into a `;` separator token.
GUARD_CMD="${GUARD_CMD//\\$'\n'/ }"
CMD_TEXT="${GUARD_CMD//$'\n'/ ; }"
read -ra WORDS <<< "$CMD_TEXT"

blocked=0
recurring_literal=""
inv_open=0
declare -a inv=()
redirect_re='^([0-9]*[<>]|&>)'

# True if $1, after stripping the longest prefix ending in a separator,
# subshell paren, command-substitution '$('/backtick, or an assignment ('='),
# is a pgrep/pkill command word (';pgrep', 'PID=$(pgrep', '`pgrep', etc).
is_start_word() {
  local sw="$1"
  sw="${sw##*[\$(\`;=]}"
  case "$sw" in
    pgrep|pkill|*/pgrep|*/pkill) return 0 ;;
    *) return 1 ;;
  esac
}

# Evaluates one closed invocation's argument words (the command word itself
# is never passed in) as a SET: blocks when a full-cmdline flag is present
# and no argument word opens with the bracket idiom.
evaluate_invocation() {
  local w p pl lit quote_char has_f=0 has_bracket=0
  local -a literals=()
  for w in "$@"; do
    if [ "$has_f" -eq 0 ]; then
      if [ "$w" = "--full" ] || [[ "$w" =~ ^-[a-zA-Z]*f[a-zA-Z]*$ ]]; then
        has_f=1
      fi
    fi
    # Strip one leading quote character (including a leading $ that precedes
    # one, for $'...'/$"...") before checking the bracket idiom. quote_char
    # records which quote (if any) was stripped, so the un-derivable check
    # below can test the ORIGINAL word for the matching close.
    p="$w"
    quote_char=""
    case "$p" in
      \$\'*) quote_char="'"; p="${p:2}" ;;
      \$\"*) quote_char='"'; p="${p:2}" ;;
      \'*) quote_char="'"; p="${p:1}" ;;
      \"*) quote_char='"'; p="${p:1}" ;;
    esac
    if [ "${p:0:1}" = "[" ]; then
      has_bracket=1
      # A quoted bracketed pattern containing a space (`'[n]ode server.js'`)
      # reaches this word split across multiple words -- the word scan has
      # no quote awareness, so this word alone never carries the close
      # quote. When the word OPENED a quote but does not itself END with
      # the matching quote character, the full pattern spans more than one
      # word and this word's literal is un-derivable: skip deriving a
      # literal for it (but it still counts toward has_bracket, since the
      # bracket idiom itself is still present). An unquoted pattern, or one
      # fully quoted within this single word, is unaffected.
      if [ -n "$quote_char" ] && [[ "$w" != *"$quote_char" ]]; then
        continue
      fi
      # Derive the literal only for the documented idiom -- a single
      # leading one-char class. Strip a matching trailing quote first so
      # the derived literal doesn't carry a stray quote character; anything
      # more complex (no `]` closing the class at position 2) is
      # un-derivable and this word contributes no literal, skipping the
      # recurrence check below for it.
      pl="$p"
      case "$pl" in
        *\'|*\") pl="${pl%?}" ;;
      esac
      [ "${pl:2:1}" = "]" ] && literals+=("${pl:1:1}${pl:3}")
    fi
  done
  if [ "$has_f" -eq 1 ] && [ "$has_bracket" -eq 0 ]; then
    blocked=1
    return
  fi
  if [ "$has_f" -eq 1 ]; then
    # Every bracket word's derivable literal is checked, not just the last
    # one seen -- report the FIRST one (in word order) that recurs.
    for lit in "${literals[@]}"; do
      if [[ "$CMD_TEXT" == *"$lit"* ]]; then
        blocked=1
        recurring_literal="$lit"
        return
      fi
    done
  fi
}

for w in "${WORDS[@]}"; do
  # A redirect operator closes the invocation, same as a separator token.
  is_sep=0
  case "$w" in
    ';'|'&&'|'||'|'|'|'&') is_sep=1 ;;
    *) [[ "$w" =~ $redirect_re ]] && is_sep=1 ;;
  esac
  if [ "$is_sep" -eq 1 ]; then
    if [ "$inv_open" -eq 1 ]; then
      evaluate_invocation "${inv[@]}"
      [ "$blocked" -eq 1 ] && break
      inv_open=0
      inv=()
    fi
    continue
  fi

  # A trailing ';' closes an invocation like a separator token; a trailing
  # ')' or backtick closes one opened by a substitution/subshell start word.
  # Strip ';' first, then check the remainder, so "node);" and "node)" both close.
  trail=0
  if [[ "$w" == *';' ]]; then
    w="${w%;}"
    trail=1
  fi
  if [[ "$w" == *')' ]]; then
    w="${w%)}"
    trail=1
  elif [[ "$w" == *'`' ]]; then
    w="${w%\`}"
    trail=1
  fi

  if is_start_word "$w"; then
    if [ "$inv_open" -eq 1 ]; then
      evaluate_invocation "${inv[@]}"
      [ "$blocked" -eq 1 ] && break
    fi
    inv_open=1
    inv=()
  elif [ "$inv_open" -eq 1 ]; then
    inv+=("$w")
  fi

  if [ "$trail" -eq 1 ] && [ "$inv_open" -eq 1 ]; then
    evaluate_invocation "${inv[@]}"
    [ "$blocked" -eq 1 ] && break
    inv_open=0
    inv=()
  fi
done

if [ "$blocked" -ne 1 ] && [ "$inv_open" -eq 1 ]; then
  evaluate_invocation "${inv[@]}"
fi

if [ "$blocked" -ne 1 ]; then
  exit 0
fi

if [ -n "$recurring_literal" ]; then
  # Interpolate the derived literal via printf '%s', never an unquoted
  # heredoc -- the literal comes straight from the command text being
  # analyzed, and an unquoted heredoc would expand a `$(...)`/backtick
  # sequence inside it instead of just printing it.
  {
    printf '%s\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    printf '%s\n' 'SELF-MATCHING PATTERN GUARD — bracketed literal recurs unbracketed'
    printf '%s\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    printf '%s\n' 'The bracket idiom only defeats the match on the bracketed word'
    printf 'itself: this cmdline also carries the literal %s elsewhere,\n' "$recurring_literal"
    printf '%s\n' 'unbracketed. `pgrep -f`/`pkill -f` matches the WHOLE cmdline, so'
    printf '%s\n' 'it still self-matches there too.'
    printf '\n'
    printf '%s\n' 'Bracket that occurrence as well, or drop the -f/--full flag and'
    printf '%s\n' 'match by PID instead.'
    printf '%s\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  } >&2
else
  cat >&2 << 'MSG'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELF-MATCHING PATTERN GUARD — pgrep -f / pkill -f matches this shell
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`pgrep -f` / `pkill -f` matches the shell running THIS command: its own
cmdline contains the pattern. In a wait loop that never exits (two
waiters in the mined corpus ran 7.5h and 18.6h dead); with pkill it
kills the session.

Use the bracket form — `pgrep -f '[p]attern'` (the literal `[p]attern`
in your cmdline does not match the regex) — or list PIDs first and act
by PID, or wait on a PID file.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MSG
fi
exit 2
