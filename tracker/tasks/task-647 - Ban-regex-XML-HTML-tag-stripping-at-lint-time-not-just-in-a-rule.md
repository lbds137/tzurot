---
id: TASK-647
title: 'Ban regex XML/HTML tag-stripping at lint time, not just in a rule'
status: To Do
assignee: []
created_date: '2026-08-17 23:38'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 647000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 00-critical.md HTML/XML Tag Stripping already bans replace(/<[^>]*>/g, "") and names extractXmlTextContent as the replacement -- and the pattern was written anyway in #2129, merged green, and was caught only by the beta.204 release PR CodeQL run (PR #2132 fixed it). Per-PR CodeQL did NOT flag it. A documented rule that is in context and still gets violated needs a mechanism at authoring time, per 00-critical.md Fix Recurring Failures Structurally.

Fix shape, two viable homes, both existing:
(a) eslint.config.js no-restricted-syntax at line 366 -- an esquery selector on the regex literal, e.g. CallExpression[callee.property.name=replace] with a Literal[regex.pattern] test. GOTCHA: a SECOND block at line 523 replicates the main one, and the header comments at lines 18 and 53 warn that an override block drops these rules -- so any addition must land in BOTH blocks or it silently does not apply to the overridden globs.
(b) packages/tooling/src/eslint/ custom plugin -- 8 rules there already, each with a colocated test (see component-handler-ack-first.ts). Heavier but unit-testable, and it fires through .claude/hooks/eslint-on-edit.sh at authoring time.

Prefer (b) if the esquery selector cannot express the regex-content match cleanly; verify which by prototyping the selector first.

Acceptance: a newly written replace(/<[^>]*>/g, "") in services/ or packages/ fails pnpm lint, with a message naming extractXmlTextContent. Rule has a colocated test if it lands in the plugin. Positive-control the rule by reintroducing the pattern and confirming lint goes red.
<!-- SECTION:DESCRIPTION:END -->
