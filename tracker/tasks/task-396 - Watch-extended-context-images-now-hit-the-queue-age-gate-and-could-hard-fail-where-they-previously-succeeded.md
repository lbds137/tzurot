---
id: TASK-396
title: >-
  Watch: extended-context images now hit the queue-age gate and could hard-fail
  where they previously succeeded
status: To Do
assignee: []
created_date: '2026-08-01 22:17'
labels:
  - 'size:S'
  - 'area:ai-worker'
  - 'area:jobs'
dependencies: []
priority: medium
ordinal: 396000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Raised by #1894 review (post-autosquash), non-blocking, explicitly a post-deploy watch rather than a change request.**

#1894 moved extended-context image resolution to the pipeline front door, which means those images now enter `DownloadAttachmentsStep` and pass through `checkQueueAge` — a gate they previously **skipped entirely**, because the field was absent when that step ran and they were derived later in `DependencyStep`.

That is the intended fix (previously they reached vision as raw CDN URLs that could have expired while the job sat in a backed-up queue). But it is a genuine behaviour change with a failure mode in the other direction: **a job that previously succeeded on stale-but-still-fetchable extended-context URLs can now hard-fail earlier**, if the queue-age heuristic is more conservative than actual Discord CDN expiry.

**What to look for**: after #1894 reaches prod, watch ai-worker for queue-age rejections (`URLs have likely expired` and neighbours) on jobs that carry extended-context images but whose TRIGGER attachments were fine. That asymmetry is the tell — trigger attachments were always gated, so a job failing the gate only now is one whose extended-context images are what tripped it.

**If observed**: the question is whether `checkQueueAge` is calibrated for CDN reality or is simply stricter than it needs to be. Options then are to relax the threshold, or to gate extended-context images separately from trigger ones (they are lower-stakes — a missing extended-context description degrades context, a missing trigger attachment breaks the message the user actually sent).

**Promote when**: the asymmetric failure above is seen in prod, OR one release passes with no such rejections, in which case archive this with that as the evidence.

Not filed as a defect — the change is correct and deliberate. This exists so the trade is checked rather than assumed, since the whole point of #1894 was removing a failure mode that nobody could see.
<!-- SECTION:DESCRIPTION:END -->
