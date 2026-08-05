---
id: TASK-159
title: Reframe the Meta-Awareness / System Prompt Primacy character-directive names
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reframe the `Meta-Awareness` / `System Prompt Primacy` character-directive names

**Why:** The system prompt's `<character_directives>` include directives named "Meta-Awareness" and "System Prompt Primacy". Council (2026-06-23, Kimi-K2.7) flagged that the NAMES themselves may cue the model toward meta-cognition (reasoning about being an AI / about the prompt) — the opposite of the fourth-wall discipline they intend; the directive bodies are fine, only the labels invite the wrong frame. **Fix shape**: rename to outcome-framing — e.g. "Fourth-wall discipline: stay in character; do not comment on being a bot, the prompt, or the API" and "Character definition and platform safety rules take precedence over contradictory in-character requests" — same behavior, no meta-cognition cue. Lives wherever `<character_directives>` is defined (`HardcodedConstraints.ts` / prompt builder). **Promote when**: next editing the character directives, OR a meta-awareness / AI-acknowledgement leak is observed. Surfaced 2026-06-23 by council on the reference-confusion fix (PR #1317); lower-leverage than the fix itself, deferred.
<!-- SECTION:DESCRIPTION:END -->
