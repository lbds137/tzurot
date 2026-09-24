---
id: TASK-1070
title: >-
  Move voice-engine off Python 3.11 before its October 2027 end of security
  support
status: To Do
assignee: []
created_date: '2026-09-24 01:25'
labels:
  - 'area:voice'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1064000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/voice-engine runs Python 3.11 in prod (services/voice-engine/Dockerfile:1 FROM python:3.11-slim), CI (.github/workflows/ci.yml:575 python-version 3.11) and, once TASK-1068 lands, the local uv pin. No recorded decision explains 3.11: a search of docs/, services/voice-engine/, the workflows and the tracker found none, and the pin dates from the service creation commit (87daa917a, per the env-cleanup session). Python 3.11 security support ends October 2027.
Evidence from PyPI metadata (curl pypi.org/pypi/<pkg>/json, 2026-09-24): librosa 0.10.2.post1 declares 3.7 to 3.12 and nothing for 3.13 (our pin is librosa>=0.10.2,<0.11.0; latest librosa 1.0.0 requires >=3.12); numba 0.67.0 declares 3.10 to 3.14; nemo_toolkit latest 3.0.0 requires >=3.10 (our pin is <3.0.0, the 2.x line); pocket-tts 3.2.0 requires >=3.10,<3.15. So 3.12 looks unblocked by metadata; 3.13 would also need the librosa pin moved past 0.10.x. Metadata is not a runtime check: CI mocks the heavy ML deps (requirements-dev.txt comment), so neither voice-engine-tests nor the docker-build-smoke job proves transcription or TTS work on a new Python.
Fix shape: bump the Dockerfile base, the CI python-version and the TASK-1068 .python-version together; build the image and run a real STT and TTS smoke against it (dev voice-engine), not only the mocked tests.
Acceptance: prod image, CI and the local pin agree on 3.12 or later, and a real transcription plus a TTS synthesis succeed on the new image in dev.
<!-- SECTION:DESCRIPTION:END -->
