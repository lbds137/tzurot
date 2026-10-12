---
id: TASK-1142
title: >-
  no-raw-log-content: a filename inside contentPreview() escapes Pattern C;
  filenameShape exemption and operationName fallback nits
status: To Do
assignee: []
created_date: '2026-09-27 23:42'
updated_date: '2026-09-27 23:43'
labels:
  - 'area:tooling'
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 3 on PR #2552 (TASK-1121), 2026-09-27. (1) packages/tooling/src/eslint/no-raw-log-content.ts collectCall: the contentPreview branch returns without walking its arguments, so logger.info({ p: contentPreview(attachment.name, 20) }) yields no rawFilename finding and would log up to 20 raw chars of the filename stem. contentPreview only returns a value with NODE_ENV=development and LOG_CONTENT_PREVIEWS=true, so no prod leak today, but it is a gap in the rule's promise that new raw filename reads are flagged. (2) The filenameShape exemption is unconditional, so a bare template interpolation of the whole object at an Error sink passes lint and renders [object Object]; the documented Error-sink remedy is filenameShape(name)?.extension. (3) AudioTranscriptionJob.ts / ImageDescriptionJob.ts operationName renders '(.unknown)' when there is no extension (hard-coded dot plus fallback word); the no-extension branch is untested.

What: (1) inside contentPreview's subtree, still run the filename check (a file-ish name read under contentPreview is rawFilename), with a test; (2) at an Error sink, flag a filenameShape(...) call used directly in a template literal or string concatenation unless followed by .extension (or document and test the limit); (3) render '(no extension)' instead of '(.unknown)', with a test for the no-extension branch.

Acceptance: each of the three has a failing-then-passing test; lint over all packages stays clean.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
(4) Merge-gate claim scan on #2552: packages/common-types/src/utils/logContentPreview.ts filenameShape docblock says it 'never returns any part of the name itself' — false as written, the extension IS part of the name (review round 3 item 5). Reword to 'never returns the stem' and state the extension caveat (a <=10-char alnum suffix passes through).
<!-- SECTION:NOTES:END -->
