---
id: TASK-1155
title: >-
  voice-engine memory headroom on Python 3.13 vs the 4 GB ceiling assumed in
  server.py is unmeasured
status: To Do
assignee: []
created_date: '2026-10-04 16:25'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1147000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1070 moved voice-engine to Python 3.13. Its watch item, local podman peak 5.8 GB against the 4 GB ceiling that server.py comments assume (TTS cap, concurrency semaphore, chunked STT), was never closed. The TASK-1070 closure rested on prod transcription and TTS log lines, not on a memory reading.
What: read the Railway memory graph (or a measured peak) for prod and dev voice-engine across a TTS synthesis and a long STT. Also confirm the actual plan memory limit that the 4 GB comments assume.
Acceptance: a measured peak and the real limit recorded here. If peak/limit is above ~80%, file the cap change (TTS length, semaphore, chunk size) with the numbers.
Note: a railway logs probe on 2026-10-04 returned empty output (not evidence either way).
<!-- SECTION:DESCRIPTION:END -->
