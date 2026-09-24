---
id: TASK-1078
title: >-
  Check whether nemo_toolkit 2.7.3 honors NEMO_CACHE_DIR; the Dockerfile comment
  says it does
status: To Do
assignee: []
created_date: '2026-09-24 13:20'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1071000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Dockerfile CMD comment (services/voice-engine/Dockerfile, grep NEMO_CACHE_DIR) says NEMO_CACHE_DIR covers NeMo's extraction cache and is honored by nemo_toolkit 2.x, so a Railway volume keeps Parakeet's extracted model across redeploys and serverless wakes. Runtime observation (TASK-1070 local image run, 2026-09-24, nemo-toolkit 2.7.3 on Python 3.13): with NEMO_CACHE_DIR=/cache/nemo and HF_HOME=/cache/huggingface on a mounted volume, Parakeet loaded and only huggingface/ filled; /cache/nemo was never created. One local run, so not conclusive: the extraction may go to a temp dir, or 2.7.3 may skip extraction when loading through the HF hub.
Fix shape: in the built image, load Parakeet with NEMO_CACHE_DIR set and trace where the .nemo archive extracts (strace or a NeMo debug log, or read the 2.7.3 restore path). Then either point the cache at the directory NeMo really uses, or correct the comment. If extraction repeats on every cold start, measure its cost on a dev wake.
Acceptance: the Dockerfile comment states what 2.7.3 actually does, backed by the observation, and a dev cold start does not re-extract if a volume path can prevent it.
<!-- SECTION:DESCRIPTION:END -->
