---
id: TASK-1402
title: >-
  Character-definition author notes: code-side out-of-character framing, user
  guidance and template
status: To Do
assignee: []
created_date: '2026-11-11T03:13:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:owner
dependencies: []
priority: medium
ordinal: 1385000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: character cards carry bracketed passages that comment on the character (author notes) rather than describe it. Measured by the Characters project on 154 private cards: 773 such notes, 63 of them 40+ characters long inside the three voice-anchor fields (conversationalExamples 58, personalityTone 4, personalityTraits 1). The voice anchor re-states those three fields next to the live turn (services/ai-worker/src/services/prompt/VoiceAnchorFormatter.ts:23-27), so a note there is repeated with no framing. The owner ruled that this is judgment, so it does not belong in the platform constraints (HardcodedConstraints.ts), and that a card standard must be communicated to users.

What: (1) a code-side framing for the character definition: a passage in square brackets inside the character definition that comments on the character is an out-of-character note: know it, act on it, never speak or quote it. It must exclude platform labels ([Image: ...], [Voice message: ...] and the rest named in OUTPUT_CONSTRAINTS) and the @[name](user:id) mention format, and it must cover the voice anchor. (2) User-facing guidance text. (3) The /character template (template.ts) and CHARACTER_JSON_TEMPLATE (import.ts:83) document the convention. Draft directive wording is in the private tzurot-characters research notes; keep the public wording generic.

Acceptance: a prompt-assembly test shows a bracketed note framed as out-of-character in both the card section and the voice anchor, with platform labels and mentions untouched; the template and guidance mention the convention.

Owner question: when should this be built?
Recommendation: after the attachment-provenance loose ends (TASK-1395 family) - it is a new feature, and the 11-04 ruling puts loose ends first.
<!-- SECTION:DESCRIPTION:END -->
