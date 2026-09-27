---
id: TASK-1120
title: 'WebM video-track sniff: add Chromium A/V and other-muxer fixtures'
status: To Do
assignee: []
created_date: '2026-09-27 10:08'
labels:
  - 'area:ai-worker'
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2545 (TASK-1112) routes a plain, unflagged `video/webm` upload to STT when `ebmlHasVideoTrack` (`services/ai-worker/src/services/multimodal/voiceContainerSniff.ts`) finds no `V_` CodecID before the first Cluster. The scan is a byte-pattern scan, not an EBML element-tree walk. It is pinned by one real audio-only fixture (Chromium 154 MediaRecorder, audio/webm;codecs=opus) and one real audio+video fixture (ffmpeg libvpx+libopus). There is NO Chromium audio+video fixture: headless Chrome returned an empty blob twice for a canvas captureStream recording. There are also no fixtures from other muxers (Firefox MediaRecorder, OBS, mkvmerge). The failure directions: a false negative (a real video routed to STT, wasting a transcription and attaching a garbage transcript) or a false positive (an audio-only file from an unseen muxer stays a file stub). claude-review round 2 asked that the gap get a tracked disposition.

What: add header-prefix hex fixtures (the pattern in `services/ai-worker/src/test/mocks/fixtures/webmHeaders.ts`) for (a) a Chromium MediaRecorder audio+video WebM, recorded in a visible browser tab or taken from a real Discord video upload, and (b) at least one Firefox MediaRecorder audio-only and audio+video pair. Assert `ebmlHasVideoTrack` on each. If any real file puts its CodecID past the first Cluster or the 256 KiB cap, replace the byte scan with a minimal element walk over Segment → Tracks.

Promote when: a sample is at hand (the owner uploads a real video/webm, or a visible-browser probe session is approved), or prod logs show `Plain WebM upload is audio-only; routing to STT` for a file that turned out to be a video.

Acceptance: the fixtures exist and pass, or the scan is replaced and they pass.
<!-- SECTION:DESCRIPTION:END -->
