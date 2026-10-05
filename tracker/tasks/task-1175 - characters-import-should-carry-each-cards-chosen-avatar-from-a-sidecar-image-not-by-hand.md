---
id: TASK-1175
title: >-
  characters:import should carry each card's chosen avatar from the AVATARS.json
  manifest
status: To Do
assignee: []
created_date: '2026-10-05 00:40'
updated_date: '2026-10-05 00:41'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner expects avatars to be imported by Tzurot along with the cards ("avatars get imported by Tzurot", via the Characters session 2026-10-04). Today characters:import only carries an avatar when the card JSON itself holds a base64 avatarData string (packages/tooling/src/characters/classify.ts diffListAndMediaFields, which counts any non-null string as a change), and the cards repo deliberately keeps images out of the card JSON: a 3.4 MB base64 field would make that card read changed on every dry run. The literal-cat avatar went in on 2026-10-04 as a one-off (a temporary copy of the card plus avatarData, built outside both repos; dev row now holds a 45 KB optimized PNG).
What: read the avatar manifest images/AVATARS.json (convention and rules in the implementation notes) with a characters:import --avatars flag; the importer base64-encodes the file only when its content hash differs from a hash recorded for the stored avatar, so an unchanged avatar does not read as changed on every run (needs a stored hash, or compare against the optimized bytes the gateway would produce).
Acceptance: a dry run lists an avatar change only for a new or changed image; apply sets it; a re-run reports unchanged; the image never lands in the Tzurot repo.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Convention agreed with the Characters session 2026-10-04: a manifest, images/AVATARS.json in tzurot-characters (main d8ecd13), a flat JSON object slug -> path of the chosen image relative to images/ (e.g. {"literal-cat": "OC/literal animals/literal-cat-v3.jpeg"}). Rules: a slug appears only once its avatar is decided; paths may contain spaces; any extension (do not assume .jpeg); a path that does not resolve refuses THAT slug, never aborts the batch; a slug absent from the manifest means leave the bot avatar alone (never clear). Chosen over a per-slug sidecar because every variant already exists as <slug>-vN.jpeg, so a sidecar would duplicate multi-MB binaries in git per pick.
<!-- SECTION:NOTES:END -->
