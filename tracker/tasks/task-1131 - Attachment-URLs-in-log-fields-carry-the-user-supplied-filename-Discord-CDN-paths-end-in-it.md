---
id: TASK-1131
title: >-
  Attachment URLs in log fields carry the user-supplied filename (Discord CDN
  paths end in it)
status: To Do
assignee: []
created_date: '2026-09-27 19:05'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner ruled filenames are content (TASK-1121, 00-critical § Logging). A Discord CDN attachment URL ends in the filename (cdn.discordapp.com/attachments/<channel>/<id>/<filename>?...), so a log field carrying a raw attachment URL leaks it. Example: DownloadAttachmentsStep logs originalUrl: attachment.url. A git grep of services for url fields read off attachment/file/image/audio objects counts about 42 sites (not all are log calls); urlPrefix is used at 5.

What: decide the safe URL shape for logs (for example host plus the attachment id, dropping the final path segment and the query string), add it beside filenameShape in common-types logContentPreview.ts, extend @tzurot/no-raw-log-content to flag raw attachment-URL reads in log fields the way it now flags .name reads, and convert every site the rule finds.

Acceptance: no log field carries a raw attachment URL; lint flags a new one.
<!-- SECTION:DESCRIPTION:END -->
