---
id: TASK-278
title: 'Attribute vision descriptions in the prompt'
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
labels:
  - 'area:ai-worker'
dependencies: []
ordinal: 278000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Attribute vision descriptions in the prompt — personas think the USER wrote them — Prod-observed (owner, 2026-07-15, Azura image-pick session): the vision pipeline injects image descriptions bare into the user-message content (`[Image: <filename>]` + "This image depicts…" with no authorship marker), so the persona credited the description prose to the user ("You described the posture… with a precision the others did not receive") — flattering but wrong, and it misattributes an AI artifact as user intent. Confirmed against an /inspect prompt export: the Visual Interpretation directive says "when image descriptions are provided, engage fully" but never says WHO wrote them. Owner reviewed the raw format 2026-07-15 and widened scope: the whole injection block is confusing, not just unattributed — the `[Image: …]` marker carries Discord CDN query junk (`?ex=…&is=…&hm=<64-char hash>&` — token waste, unreadable), and there's no end boundary between a description and the user's resuming text (3-image messages blur entirely). **Fix shape** (ai-worker): (1) restructure the injection into a delimited block consistent with the prompt's XML idiom — e.g. `<attached_image name="<filename sans query params>">` + an explicit "auto-generated description (vision model — not written by the user)" lead-in + closing tag (new tag must be classified for the `check-prompt-tags` gate); (2) strip CDN query params from the displayed filename; (3) one sentence in the Visual Interpretation directive: descriptions come from an automated vision model. Character-prompt change only (no extraction eval); verify with one dev multi-image round. **Promote when**: next ai-worker prompt/vision touch, or the misattribution recurs in prod (owner formatting concern already raised twice — this is drifting toward a Quick Win).

**Why:** The description reads as user prose because structurally it IS user-message content — boundaries and attribution must both be explicit.
<!-- SECTION:DESCRIPTION:END -->
