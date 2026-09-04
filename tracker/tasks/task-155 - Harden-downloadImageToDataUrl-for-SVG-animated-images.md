---
id: TASK-155
title: Harden downloadImageToDataUrl for SVG + animated images
status: To Do
assignee: []
created_date: '2026-06-20 00:00'
updated_date: '2026-09-04 19:35'
labels:
  - 'origin:review'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Harden `downloadImageToDataUrl` for SVG + animated images

**Why:** The shared image→vision download helper (`imageToDataUrl.ts`) routes everything through `resizeImageIfNeeded`, which assumes raster input. An SVG (`image/svg+xml`) could mis-decode (1×1 raster) or OOM on recursive `<use>`/embedded data; an animated GIF/APNG/WebP silently loses all but the first frame on the JPEG re-encode. Per-attachment size/timeout caps already exist in `fetchAttachmentBytes`, so this is purely format handling. **Fix shape**: reject SVG by content-type/magic-bytes (or rasterize with a bounded viewport, e.g. sharp `density`+max-dims) before resize; add a `supportsAnimation` provider flag and skip JPEG re-encode (preserve GIF/WebP/APNG) when the target vision model supports it. **Promote when**: a user reports an SVG/animated embed mis-described, OR onboarding a video/animation-capable vision model. Surfaced 2026-06-20 (council review of the image→vision consolidation; deferred as independent hardening). Deferred 2026-06-20.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:35
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `imageToDataUrl.ts` still routes every attachment through `resizeImageIfNeeded` with no SVG/animation-specific handling — no mention of "svg" or "animat" anywhere in the file. Promote trigger (a reported SVG/animated mis-description, or an animation-capable vision model) hasn't fired. Evidence: `git grep -n "svg|SVG|animat|supportsAnimation" services/ai-worker/src/utils/imageToDataUrl.ts` → 0 hits; `resizeImageIfNeeded` is still the sole path.
---
<!-- COMMENTS:END -->
