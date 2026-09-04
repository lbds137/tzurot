---
id: TASK-642
title: 'Hook: warn on a grep pattern whose regex-special char was eaten by the shell'
status: To Do
assignee: []
created_date: '2026-08-17 12:27'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 642000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on 2026-08-17 (PR #2124) `grep -rn "\$extends" services/api-gateway/src` returned empty, was read as "no call site does this", and that false absence was written into a doc comment that deleted a real and live example. The reviewer caught it. Measured mechanism: the backslash must SURVIVE the shell so grep receives `\$`. In double quotes the shell consumes it, grep gets a bare `$`, treats it as an end-of-line anchor, and matches nothing — silently, exit 1, indistinguishable from a genuine absence.

Measured forms (probed, not assumed): double-quoted backslash-dollar = no match; single-quoted bare dollar = no match; single-quoted backslash-dollar = match; -F with the literal = match.

This is 3-for-3 on the 00-critical structural-fix questions: the trigger is deterministic (a Bash command containing grep with a regex-special char in the pattern), the correction is mechanical (-F, or single quotes preserving the backslash), and it fires without model attention. The existing positive-control rule covers the class and did NOT fire.

Fix shape: a PreToolUse hook alongside lossy-pipe-guard.sh that inspects Bash commands for a grep/rg invocation without -F whose pattern contains an unescaped regex-special leader that is likely meant literally — in particular a dollar sign immediately followed by an identifier character, which is almost never a valid anchor use. Warn, do not block: suggest -F or the single-quoted backslash form. ripgrep differs from grep here, so probe rg separately before covering it.

Acceptance: the hook fires on the double-quoted dollar form and stays silent on legitimate anchor use (a trailing dollar), on -F invocations, and on ordinary patterns. Probe harness added per guard:hook-probes, which is bidirectional over the hooks directory, so a new hook without a probe fails CI.

Hooks are review-gated, so this needs its own PR — not a ride-along.

GROUNDING 2026-09-03, before any code. Three findings, two of which change the fix shape above.

1. WARN-ONLY IS NOT IMPLEMENTABLE — owner call 2026-09-03: BLOCK instead (exit 2), with a narrow trigger. The fix shape above says warn, do not block. A non-blocking hook's output never reaches the agent: two hooks in this repo already record that, probed directly — claim-shape-guard.sh:56 and pr-merge-review-check.sh:18 — and pr-merge-review-check.sh:929 notes stderr reaches the agent only on the blocking path. No hook here uses the PreToolUse JSON permissionDecision route, so that alternative is unprecedented and was declined; it would also put a prompt in front of the owner for commands they did not run. A warn-only build would pass its own probe and be inert, which is the coverage-illusion class this task exists to prevent.

2. THE TRIGGER IS SHARPER THAN FILED. A PreToolUse hook reads tool_input.command BEFORE the shell touches it, so the failing form arrives with its backslash intact: grep -rn "\$extends" reaches the hook as the literal characters backslash-dollar inside double quotes. So the trigger is not the filed a dollar sign immediately followed by an identifier character — it is specifically backslash-dollar plus an identifier char inside a DOUBLE-quoted grep/rg pattern with no -F. The correct single-quoted form and a legitimate trailing anchor both sit outside that shape entirely, so false positives should be near zero. Whether a bare "$identifier" in double quotes (shell-expands to empty, so grep over-matches instead of under-matching) also warrants the block is an open call for the implementer, with reasoning required either way.

3. RG DOES NOT DIFFER — the filed open question is answered, measured 2026-09-03 against a two-line fixture. All three quoting forms behave identically in grep and rg: double-quoted backslash-dollar = no match (both), single-quoted bare dollar = no match (both), single-quoted backslash-dollar = match (both); grep -F with the literal = match. Positive control for the silence half: grep -rn on a trailing anchor against a line ending in that word matches, exit 0. So one hook covers both tools and the separate rg probe the task asked for is unnecessary.

Structural model: python-heredoc-edit-guard.sh (80 lines, probe 104) — PreToolUse/Bash matcher, two independent grep -P checks that must BOTH match, grep exit status captured explicitly so a PCRE error is not read as no match, fail-open on anything else, exit 2 with a stderr banner. New hook also needs a row in packages/tooling/src/dev/check-hook-probes-registry.ts (HOOK_PROBES) and a PreToolUse entry in .claude/settings.json; guard:hook-probes is bidirectional, so a new hook without a probe fails CI.

GROUNDING 2026-09-04 — correction to the Why and to finding 3. The mechanism is grep-ENGINE dependent, measured this session on two engines. The driver shell on this machine resolves /usr/bin/grep to ugrep 7.8.4 (SteamOS host, PATH-first), and under ugrep a dollar anywhere in the pattern is an anchor, so the eaten form matches nothing: the incident command grep -rn "\$extends" services/api-gateway/src returns rc 1 live today against three real hits (routeDeps.ts:69, dbTimeout.test.ts:205, dbTimeout.ts:181), which git grep -n -- '$extends' finds because git grep uses GNU basic-regex semantics. GNU grep 3.11 in basic mode (measured in the tzurot-dev container, Fedora 41, same fixture: basic eaten rc 0, -E eaten rc 1, -P eaten rc 1, survived rc 0 in both, -F rc 0) treats a mid-pattern dollar as a LITERAL, so the eaten form matches there by accident; GNU grep -E, -P, rg, and git grep -E/-P all anchor like ugrep. So the eaten form is wrong on this machine's driver shell and only luck elsewhere, while the single-quoted backslash form is rc 0 on every engine and mode measured.

Scope decision (engineering call, evidence above): the hook stays on plain grep and git grep as well as -E/-P/egrep/rg. The form as written never expresses what the author wrote — the backslash they put there is gone before any program sees it — the correction is the same one-character change in every mode, and narrowing to the always-anchoring modes would miss the exact incident on the driver's shell. Finding 3 above (rg does not differ) holds for ugrep versus rg; the GNU-basic-mode exception is what it missed, and the hook's header comment states the split rather than the old single-mechanism claim.
<!-- SECTION:DESCRIPTION:END -->
