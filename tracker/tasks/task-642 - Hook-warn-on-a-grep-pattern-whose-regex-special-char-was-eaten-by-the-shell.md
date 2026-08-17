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
<!-- SECTION:DESCRIPTION:END -->
