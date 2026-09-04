---
id: TASK-95
title: STT CHECK constraint companion migration when 4th provider ships
status: To Do
assignee: []
created_date: '2026-05-10 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'area:voice'
  - 'area:db'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

STT CHECK constraint companion migration when 4th provider ships

**Why:** `valid_default_stt_provider_id` CHECK hardcodes `'mistral' | 'elevenlabs' | 'voice-engine'`. When a 4th STT provider lands (Groq, Deepgram, OpenAI Whisper-direct, etc), the migration needs a companion `ALTER TABLE users DROP CONSTRAINT ... ADD CONSTRAINT ... IN (..., 'new-provider')`. Cross-reference comment already in `sttProvider.ts` and the migration file. **Promote when**: a 4th STT provider is on the roadmap. Surfaced 2026-05-10. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: a fourth STT provider trips the CHECK constraint loudly at that moment.
---
<!-- COMMENTS:END -->
