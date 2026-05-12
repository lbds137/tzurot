## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

_(Empty — drained 2026-05-12 across PRs #1023–#1026.)_

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.
