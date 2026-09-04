---
id: TASK-159
title: Reframe the Meta-Awareness / System Prompt Primacy character-directive names
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 159000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Reframe the `Meta-Awareness` / `System Prompt Primacy` character-directive names

**Why:** The system prompt's `<character_directives>` include directives named "Meta-Awareness" and "System Prompt Primacy". Council (2026-06-23, Kimi-K2.7) flagged that the NAMES themselves may cue the model toward meta-cognition (reasoning about being an AI / about the prompt) — the opposite of the fourth-wall discipline they intend; the directive bodies are fine, only the labels invite the wrong frame. **Fix shape**: rename to outcome-framing — e.g. "Fourth-wall discipline: stay in character; do not comment on being a bot, the prompt, or the API" and "Character definition and platform safety rules take precedence over contradictory in-character requests" — same behavior, no meta-cognition cue. Lives wherever `<character_directives>` is defined (`HardcodedConstraints.ts` / prompt builder). **Promote when**: next editing the character directives, OR a meta-awareness / AI-acknowledgement leak is observed. Surfaced 2026-06-23 by council on the reference-confusion fix (PR #1317); lower-leverage than the fix itself, deferred.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER RULING (C5): keep, retargeted. The directive names are not in code: both live in the shared Default system prompt row (system_prompts id 39e0f96c-c59c-58df-9aa8-c9ee0bd54136, is_default, used by 205 of 208 personalities, identical on dev and prod, verified by query 2026-09-04). No admin write path exists for system_prompts content (TASK-363), so the fix is a one-row data edit applied to both environments, sync-tracked table. Trigger unchanged: next edit of the Default prompt, or an observed meta-awareness leak.
---
<!-- COMMENTS:END -->
