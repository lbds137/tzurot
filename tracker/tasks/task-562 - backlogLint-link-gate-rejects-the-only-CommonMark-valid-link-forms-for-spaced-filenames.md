---
id: TASK-562
title: >-
  backlogLint link gate rejects the only CommonMark-valid link forms for spaced
  filenames
status: To Do
assignee: []
created_date: '2026-08-12 22:33'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 562000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every tracker/docs and tracker/tasks filename contains spaces, and CommonMark/GitHub only render links to such files when the target is %20-encoded (what GitHub copy-link produces) or angle-bracket wrapped. checkRelativeLinks passes the target verbatim to existsSync - no decodeURIComponent, no <...> unwrapping - so both valid forms are reported dangling (false CI block with a confusing resolved: path) while a bare-spaced target, which does NOT render as a link, passes. Latent today (zero encoded links exist; corpus migrated to doc-N refs), but the first GitHub-copied link reddens pnpm quality. Related disclosed cost (no action forced): checkDocIdRefs gates on doc-N tokens in fenced code blocks and turns historical mentions of archived docs into failures.

Fix shape: decodeURIComponent + angle-bracket unwrap before existsSync; optionally flag bare-spaced targets as non-rendering.

Acceptance: %20 and <...> links to a real spaced file pass; test pins both forms. Source: 2026-08-12 review (tooling reviewer M3/L1, mechanism CONFIRMED).
<!-- SECTION:DESCRIPTION:END -->
