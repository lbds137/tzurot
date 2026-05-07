## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

- 🐛 `[FIX]` **"Max age: off" should override global setting; separate "off" from "inherit"** — User note 2026-05-02. In the settings cascade, "off" (disabled) and "inherit" (use parent value) are conflated into one state. When a user sets max-age to "off" at a level where the global has a value, "off" should still mean "disabled" — it should not fall through to the global. The same issue may affect other cascade items (TTS provider, LLM config, etc.). **Fix shape**: audit all settings cascade fields for off-vs-inherit semantics; introduce a distinguishable "off" sentinel value (e.g., `null` = inherit, `false` = explicitly off, or a discriminated union). Ensure the resolver treats "off" as a terminal "no max age" rather than "use parent". Scope depends on how many cascade fields have this conflation. Surfaced 2026-05-02. Triaged from inbox 2026-05-06.

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.
