### Theme: Multimodal Input — file (PDF/doc) + video forwarding

_Focus: capture and forward `video` and `file` input modalities to capable models, then surface the capability in `/models`. Companion to — not the same as — the "Multi-Modality" output features under Next-Gen AI Capabilities above (that one is image generation)._

**Surfaced 2026-06-15 (user)** while reviewing `/models browse` modality coverage. OpenRouter's `ModelModality` is `text | image | audio | video | file`, but we only capture/route **text, image, audio**. `video` and `file` (PDF/doc) input modalities are dropped from `ModelAutocompleteOption` (`OpenRouterModelCache.toAutocompleteOption`), and — more fundamentally — the bot can't *send* them: `MessageContentBuilder` renders every non-voice/non-image attachment as a **text description** (`[Attachments: [application/pdf: doc.pdf]]`), never as native model input. So surfacing `supportsFileInput`/`supportsVideoInput` today would over-promise.

**The user wants to build these for real.** Two-part feature:

1. **Bot-side forwarding**: detect PDF/doc (and eventually video) attachments and forward them to capable models as native input (OpenRouter `file`/`video` content parts), not just a text mention. Gate per-model on the model's advertised input modalities.
2. **`/models` surfacing** (only after #1 ships, else it misleads): add `supportsFileInput`/`supportsVideoInput` flags to `ModelAutocompleteOption` (+ Zod schema) and `toAutocompleteOption`; render badges in the browse list + card; consider browse capability filters for `file`/`video` (and `audio`, which we already capture but don't expose as a filter).

**Plumbing already half-present**: `ModelModality` includes `video`/`file` and the gateway's `getFilteredModels` accepts them as `inputModality` — only the autocomplete projection + browse UI drop them. **Promote when**: prioritized as a feature (it's a real capability gap, not a defect).

#### chunkr (2026-07-05 ingest)

Self-hostable document-ingestion service (PDF/PPTX/DOCX/images → layout-aware OCR → structured HTML/MD chunks for RAG; Docker, AGPL-3.0 + commercial dual-license; OSS lacks the cloud's proprietary models; maintenance slowing — v2.2.1 July 2025). Candidate for the file-upload parsing seam IF we want structure-preserving ingestion; AGPL needs a look before any embed. The agentic design's file-parser plugin note is the integration point.
