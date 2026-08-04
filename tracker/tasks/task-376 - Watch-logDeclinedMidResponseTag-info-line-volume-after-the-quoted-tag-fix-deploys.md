---
id: TASK-376
title: >-
  Watch logDeclinedMidResponseTag info-line volume after the quoted-tag fix
  deploys
status: To Do
assignee: []
created_date: '2026-07-31 03:06'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:S'
  - 'area:ai-worker'
dependencies: []
priority: low
ordinal: 376000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by #1880 round-3 review. The new logger.info in thinkingExtraction.tryFallbackExtraction fires whenever fallback extraction runs AND a mid-response opening thinking tag is present. Fallback runs on most replies that contain no complete tag pair, so the exec runs often; the log itself only fires on a literal angle-bracket tag, which should be rare.

Why it was added rather than skipped: the mid-response-unclosed-tag case is unobserved, not impossible. Declining to extract there is a deliberate trade, and this line is the only way we would learn the declined case is real rather than theoretical. It is permanent observability (feat), not scaffolding (debug) - do not sweep it as stale instrumentation.

Observable to check: after the fix reaches prod, look at ai-worker logs for "Opening thinking tag mid-response". Two outcomes worth acting on - (a) high volume means the exec/scan pair is running hotter than expected and the line should drop to debug or gain a rate limit; (b) any occurrence where quoted=false is genuinely interesting, because it is the unobserved genuine-mid-response-reasoning case and would justify revisiting the position discriminator.

Outcome (b) is the valuable one. If it never fires with quoted=false over a reasonable window, that is positive evidence the head-anchor assumption is correct, and worth recording in the task before closing.
<!-- SECTION:DESCRIPTION:END -->
