# LTM Context Separation - Prompt Improvement

## Problem

LLM sometimes treats long-term memories (LTM) as if they are part of the current conversation, responding to old memories with higher priority than the actual current message. This is a classic RAG hallucination issue.

## Root Cause

The memories are formatted similarly to conversation text with just a markdown header:

```
## Relevant Memories
- [timestamp] content
```

The LLM sees dialogue-like text and confuses it with the current conversation.

## Solution (Recommended by Gemini)

Use three techniques to create a "firewall" between memory and current conversation:

### 1. XML-Style Delimiters

Wrap different sections in distinct tags that LLMs recognize as data containers:

- `<background_context>` for memories
- `<current_situation>` for date/location/participants
- `<conversation_history>` for actual conversation

### 2. Stronger Temporal Language

Change "Relevant Memories" to "ARCHIVED HISTORICAL LOGS" - forces the LLM to treat it as reference data, not dialogue.

### 3. Explicit Negative Constraint

Add to system prompt:

> NEVER respond to content within `<background_context>` directly. Your task is to reply ONLY to the final message in `<conversation_history>`.

## Files to Modify

### 1. MemoryFormatter.ts (`services/ai-worker/src/services/prompt/MemoryFormatter.ts`)

Current:

```typescript
return '\n\n## Relevant Memories\n' + formattedMemories;
```

Change to:

```typescript
return (
  '\n\n<background_context>\n## Archived Historical Logs (READ-ONLY)\n' +
  formattedMemories +
  '\n</background_context>'
);
```

### 2. PromptBuilder.ts (`services/ai-worker/src/services/PromptBuilder.ts`)

Wrap conversation history similarly:

```typescript
return '<conversation_history>\n' + conversationHistory + '\n</conversation_history>';
```

### 3. System Prompt (Database)

Update the "Conversational Context Protocol" section to explain the tags and add the negative constraint.

## Testing Plan

1. Unit tests for new formatting
2. Manual testing with long conversations that trigger LTM retrieval
3. Verify LLM responds to current message, not memories

## Related

- Gemini consultation on 2025-12-06
- Issue observed in production where LLM responded to LTM content instead of current message
