#!/bin/bash
# UNREGISTERED — retained for reference, not wired into .claude/settings.json.
#
# After a Bash command that discarded stderr (`2>/dev/null`) and returned EMPTY
# stdout, this injects a non-blocking reminder that the empty result may be a
# swallowed failure rather than an absence of data.
#
# It cannot be made to work in any available channel. The trigger needs the
# command's RESULT, which exists only post-hoc — so PostToolUse is the only
# matching event — and non-blocking PostToolUse output never reaches the agent
# (probed directly, confirmed for every matcher). The constraint it guards is
# real and stays in .claude/rules/10-working-posture.md § "Lossy steps are for
# known output shapes"; the RULE is the mechanism, not this hook. Do not cite
# this file as a structural backstop while it is unregistered — see TASK-458.
#
# That exact shape — errors routed to /dev/null, nothing on stdout — is how a
# malformed identifier's error message vanished and the resulting empty output
# then read as "no data", nearly reversing real findings more than once. The
# constraint lives in .claude/rules/10-working-posture.md § "Lossy steps are
# for known output shapes". This hook was written to be that rule's structural
# backstop, firing at the moment of the empty result instead of relying on agent
# attention — it never achieved that, per the header above, and the rule text is
# the mechanism.
#
# Scope rationale — only the literal `2>/dev/null` (with optional whitespace
# after `2>`) triggers:
#   - `2>&1` MERGES stderr into stdout. Nothing is lost, so an empty result
#     there really is an empty result.
#   - `&>/dev/null` / `>/dev/null 2>&1` deliberately discard stdout TOO. Those
#     are exit-code-only invocations where empty stdout is the expected and
#     correct outcome; a reminder would be pure noise. They also never contain
#     the literal `2>/dev/null`, which is why this trigger is naturally scoped.
#
# Fail-open by design: never blocks, never exits nonzero on its own logic paths.

set -uo pipefail

INPUT=$(cat)
TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

COMMAND=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$COMMAND" ] && exit 0

# Cheap bash-native short-circuit before any further work: the overwhelming
# majority of Bash calls contain no `2>` at all and exit here. `&>/dev/null`
# and `>/dev/null` also fall out at this gate (sibling hooks set the same
# do-cheap-checks-first precedent).
case "$COMMAND" in
*2\>*) ;;
*) exit 0 ;;
esac

# Precise trigger. `2>&1` survives the case above but is rejected here.
if ! grep -qE '2>[[:space:]]*/dev/null' <<<"$COMMAND"; then
    exit 0
fi

# Same fallback chain (and same rationale) as pr-monitor-reminder.sh: Claude
# Code's PostToolUse payload field path isn't strictly documented, so try the
# known shapes in order.
#
# ASYMMETRY WORTH NAMING: if the extraction itself fails on a command that DID
# produce output, we fire a spurious reminder. That is acceptable here — this
# is a reminder, not a block, and the false-positive cost is one banner. The
# pr-monitor hook cannot make that trade (a wrong PR number there is worse than
# none), which is why it logs a drift line instead of guessing.
OUTPUT=$(jq -r '.tool_result.stdout // .tool_response.output // .output // empty' <<<"$INPUT" 2>/dev/null || echo "")

# Whitespace-only counts as empty: a lone newline carries no more information
# than nothing at all.
if [ -n "${OUTPUT//[[:space:]]/}" ]; then
    exit 0
fi

cat <<'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMPTY RESULT + SUPPRESSED STDERR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This command discarded stderr (`2>/dev/null`) and returned empty stdout.
An empty result with suppressed errors is exactly the shape where a failed
invocation — malformed identifier, wrong flag, error text thrown away — reads
as "no data". Before concluding ANYTHING from this empty result, re-run it
WITHOUT `2>/dev/null` and read the error channel.
Per .claude/rules/10-working-posture.md § "Lossy steps are for known output shapes".
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
