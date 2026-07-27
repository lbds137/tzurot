---
id: TASK-95
title: 'STT CHECK constraint companion migration when 4th provider ships'
status: To Do
assignee: []
created_date: '2026-05-10 00:00'
labels:
  - 'area:voice'
  - 'area:db'
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

STT CHECK constraint companion migration when 4th provider ships

**Why:** `valid_default_stt_provider_id` CHECK hardcodes `'mistral' | 'elevenlabs' | 'voice-engine'`. When a 4th STT provider lands (Groq, Deepgram, OpenAI Whisper-direct, etc), the migration needs a companion `ALTER TABLE users DROP CONSTRAINT ... ADD CONSTRAINT ... IN (..., 'new-provider')`. Cross-reference comment already in `sttProvider.ts` and the migration file. **Promote when**: a 4th STT provider is on the roadmap. Surfaced 2026-05-10. Deferred 2026-05-12.
<!-- SECTION:DESCRIPTION:END -->
