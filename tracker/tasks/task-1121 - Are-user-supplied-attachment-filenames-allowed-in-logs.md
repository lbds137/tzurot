---
id: TASK-1121
title: Are user-supplied attachment filenames allowed in logs?
status: Done
assignee: []
created_date: '2026-09-27 10:08'
updated_date: '2026-09-27 23:44'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ai-worker log lines carry the attachment filename (`attachment.name`) as a structured field: `MultimodalProcessor.ts` ('Processed audio attachment', and the plain-WebM routing line added in PR #2545), `plainWebmAudioSniff.ts` (the fetch-failure warn), and others in the same file. A filename is user-supplied text: a person can name an upload after anything, including names or private details. `00-critical.md` § Logging (No PII) bans usernames and message content but does not say whether a filename counts, and `@tzurot/no-raw-log-content` does not catch it. claude-review round 2 on PR #2545 flagged the class for awareness.

Owner ruling (2026-09-27): filenames are content. The recommendation below is approved as the spec; record the ruling in `.claude/rules/00-critical.md` § Logging (No PII) in the implementing PR.

Recommendation: treat them as content. Log the extension and length (a small `filenameShape` helper beside `contentPreview` in `common-types/utils/logContentPreview.ts`) instead of the raw name. The name adds little diagnostic value over the attachment id and content type, and the rule's intent is to keep user text out of logs. Then sweep the class: `git grep -n "name: attachment.name" -- services` plus the other filename fields, and consider extending the lint rule.

Acceptance: the owner's ruling is recorded in `00-critical.md` § Logging; if the ruling is "content", every filename log field goes through the helper and the lint rule flags new raw ones.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #2552 (bc870d0a8, 2026-09-27) after 3 review rounds; round-3 nits + a docblock overclaim filed as TASK-1142.
<!-- SECTION:NOTES:END -->
