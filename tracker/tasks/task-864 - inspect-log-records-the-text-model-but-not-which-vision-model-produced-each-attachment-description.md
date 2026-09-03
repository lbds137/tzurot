---
id: TASK-864
title: >-
  inspect log records the text model but not which vision model produced each
  attachment description
status: Done
assignee: []
created_date: '2026-09-02 03:57'
updated_date: '2026-09-03 00:15'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 864000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner asked twice on 2026-09-02 which model served an image description, and the /inspect debug JSON could not answer it: inputProcessing.attachmentDescriptions is a plain array of description strings, and the only routedModel in the log is the text model (glm-5.3). The answer had to come from prod ai-worker logs (VisionProcessor: Vision model responded, modelName + routedModel per attachmentId). With a three-tier vision chain now in prod (primary, router alias, concrete terminal), which tier answered is the first question about any description.

Fix shape: carry the vision model (requested name and routedModel when they differ) and the tier index alongside each description on the wire the diagnostic payload is built from — the same fields VisionProcessor already logs — and render them in the inspect JSON per attachment (for example an object {name, description, visionModel, routedModel, tier} instead of a bare string). Keep the prompt-facing rendering unchanged. Check the diagnostic schema in packages/common-types/src/types/diagnostic.ts and the DiagnosticTypes in ai-worker for where attachmentDescriptions is typed; extend both and the snapshot/schema tests.

Acceptance: an /inspect debug download for a turn with an image shows, per attachment, which vision model (and routed model) produced its description.
<!-- SECTION:DESCRIPTION:END -->
