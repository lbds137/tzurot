---
id: TASK-437
title: >-
  Derive the artifact-tag vocabulary shared between responseArtifacts and
  wrapperTagUnwrap
status: Done
assignee: []
created_date: '2026-08-05 11:29'
updated_date: '2026-08-05 12:30'
labels:
  - 'area:ai-worker'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 437000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: WRAPPER_UNWRAP_EXCLUDED_TAGS (wrapperTagUnwrap.ts) hand-restates the ~20 artifact tag names that live inline in regex literals inside buildArtifactPatterns (responseArtifacts.ts). If the pattern list changes, the exclusion set silently drifts, reopening a scaffolding-resurrection risk for whichever tag falls out of sync. Flagged by PR #1970 review rounds 1 and 3; the KNOWN_THINKING_TAGS import in the same file is the model to follow.
Fix shape: export a tag-name constant from responseArtifacts.ts, build its regexes from it, spread it into the exclusion set. Ride-along members from the same reviews (both touch these files): (a) KNOWN LIMIT pin for the non-pair-aware opener probe in stripOrphanTrailingCloser (a completed pair plus a separate same-name orphan closer keeps the stray closer - under-cleaning, not corruption); (b) explicit test pinning that span-mode depth counting only counts alone-on-line same-name tags.
Acceptance: one source of truth for the artifact vocabulary; both KNOWN LIMIT behaviors pinned visibly.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #1973 (merged 2026-08-05). ARTIFACT_TAG_NAMES exported from responseArtifacts.ts (patterns built from the same arrays), spread into WRAPPER_UNWRAP_EXCLUDED_TAGS; both KNOWN LIMIT behaviors pinned (non-pair-aware opener probe; span depth counts alone-on-line tags only). Reviewer hand-verified list+regex equivalence; zero blocking findings.
<!-- SECTION:NOTES:END -->
