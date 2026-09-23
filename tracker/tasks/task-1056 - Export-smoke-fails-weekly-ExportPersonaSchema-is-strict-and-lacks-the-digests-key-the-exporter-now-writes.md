---
id: TASK-1056
title: >-
  Export smoke fails weekly: ExportPersonaSchema is strict and lacks the digests
  key the exporter now writes
status: To Do
assignee: []
created_date: '2026-09-23 17:24'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1050000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: dev weekly export-path smoke 2026-09-23 17:00Z (owner screenshot, log channel): "json-schema: personas/Orphaned_Characters-340886e8.json failed validation ((root):unrecognized_keys)". 1247456f9 (TASK-1014, released in beta.227) made the account export carry each persona recent-days digests: AccountExportAssembler.ts:61 adds digests: ExportPersonaDigest[] to every persona and AccountExportFiles.ts:119 writes it into personas/<stem>.json. ExportPersonaSchema (packages/common-types/src/schemas/export/accountExportCoreSchemas.ts:69) is .strict() and has no digests key, so every persona file fails it. The only consumer of that schema is the smoke validator (accountExportManifest.ts:216 EXPORT file-schema table, read by services/bot-client/src/services/exportSmokeValidator.ts), so real user exports are unaffected and correct; the smoke is red every week and blind to real export regressions until fixed.
Fix shape: add digests to ExportPersonaSchema as a strict array of the ExportPersonaDigest shape (text, generated_at, window_start, personality slug + name, exactly as the assembler emits); sweep the other export file schemas against their producers for the same drift (formatVersion went 2 to 3 in that commit); add a producer-to-schema contract test that runs the real assembler/files output through the manifest file schemas, so a new producer key fails CI instead of the weekly smoke.
Acceptance: the contract test goes red when the digests key is removed from the schema; the smoke validator accepts a current export artifact; next weekly dev smoke passes.
<!-- SECTION:DESCRIPTION:END -->
