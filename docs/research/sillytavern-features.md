# SillyTavern Feature Analysis

> **Date**: 2026-01-24
> **Source**: Gemini consultation analyzing SillyTavern codebase
> **Status**: Active - features for Icebox consideration

## TL;DR

SillyTavern has years of community-driven roleplay optimization. Key portable features: PNG character card parsing (V2/V3 spec), Author's Note depth injection (beats "lost in middle"), World Info with sticky states/cooldowns, Natural Order speaker selection (deterministic heuristics vs LLM routing), local embeddings via transformers.js, and agentic skills with auto-memorize. Most useful for enhancing RAG and prompt construction.

## High-Value Features

### 1. PNG Character Card Import (V2/V3)

**What**: Store full character definition inside avatar PNG metadata.

**Implementation**:

```typescript
import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

export function parseCharacterCard(imageBuffer: Buffer) {
  const chunks = extract(new Uint8Array(imageBuffer));
  const textChunks = chunks
    .filter(chunk => chunk.name === 'tEXt')
    .map(chunk => PNGtext.decode(chunk.data));

  // V3 takes precedence
  const ccv3 = textChunks.find(c => c.keyword.toLowerCase() === 'ccv3');
  if (ccv3) return JSON.parse(Buffer.from(ccv3.text, 'base64').toString('utf8'));

  // Fallback to V2
  const chara = textChunks.find(c => c.keyword.toLowerCase() === 'chara');
  if (chara) return JSON.parse(Buffer.from(chara.text, 'base64').toString('utf8'));

  throw new Error('No character metadata found');
}
```

**Value**: Opens access to thousands of community character cards.

### 2. Author's Note (Depth Injection)

**Problem**: System prompts at context top get "lost in the middle" as context grows.

**Solution**: Inject high-priority instructions at depth 1-4 (messages from bottom).

```typescript
insertAuthorsNote(history: BaseMessage[], note: string, depth: number = 3) {
  const insertionIndex = Math.max(0, history.length - depth);
  history.splice(insertionIndex, 0, new SystemMessage(note));
  return history;
}
```

**Value**: Dramatically improves style adherence for long conversations.

### 3. World Info with Timed Effects

**Problem**: Vector RAG is probabilistic - can miss critical lore.

**Solution**: Keyword-based injection with state management.

**Features**:

- **Recursive Scanning**: If Entry A triggers, scan its content for Entry B keywords
- **Sticky**: Keep entry active for X turns after trigger
- **Cooldown**: Prevent re-triggering for Y turns

```typescript
interface TimedEffect {
  entryId: string;
  turnsRemaining: number;
  type: 'sticky' | 'cooldown';
}
```

**Value**: Guarantees critical lore is present (vector search for vibes, keywords for facts).

### 4. Logic Gates for Context

**Problem**: "King" keyword too broad - triggers wrong lore.

**Solution**: Secondary keywords with logic modes.

| Mode    | Behavior                            |
| ------- | ----------------------------------- |
| AND_ANY | Primary + at least one secondary    |
| NOT_ALL | Primary + NO secondary keys present |
| AND_ALL | Primary + ALL secondary keys        |

**Example**: "King" + NOT("Chess", "Playing cards") = only historical kings.

### 5. Natural Order Group Orchestration

**Problem**: Deciding who speaks in group chats is expensive (LLM routing).

**Solution**: Deterministic heuristics.

```typescript
function selectNextSpeaker(candidates, userMessage, lastSpeakerId) {
  const inputWords = extractAllWords(userMessage);

  // 1. Direct mention wins
  for (const char of candidates) {
    if (char.id === lastSpeakerId) continue;
    if (inputWords.some(word => char.name.toLowerCase().includes(word))) {
      return char.id;
    }
  }

  // 2. RNG based on talkativeness trait
  for (const char of shuffle(candidates)) {
    if (char.id === lastSpeakerId) continue;
    if (Math.random() < (char.talkativeness ?? 0.5)) {
      return char.id;
    }
  }

  return null; // No one speaks
}
```

**Value**: Zero LLM calls for speaker selection.

### 6. Local Embeddings

**Source**: `@xenova/transformers`

```typescript
import { getPipeline } from '../transformers.js';

export async function getLocalVector(text: string): Promise<number[]> {
  const pipe = await getPipeline('feature-extraction');
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}
```

**Value**: Eliminates embedding API costs. Already implemented in `@tzurot/embeddings`.

### 7. Claude Thinking Token Support

**Implementation** (from chat-completions.js):

```typescript
if (useThinking && Number.isInteger(budgetTokens)) {
  const minThinkTokens = 1024;
  if (requestBody.max_tokens <= minThinkTokens) {
    requestBody.max_tokens += minThinkTokens;
  }
  requestBody.thinking = {
    type: 'enabled',
    budget_tokens: budgetTokens,
  };
  // CRITICAL: Remove sampling params when thinking enabled
  delete requestBody.temperature;
  delete requestBody.top_p;
  delete requestBody.top_k;
}
```

## Lower Priority Features

- **Regex Scripts**: Post-process LLM output (fix spelling, strip thinking tags)
- **Slash Command Pipelines**: Pipe operator for chaining commands
- **Stealth Tools**: Tool calls hidden from chat history (for immersion)

## Actionable Items

See ROADMAP.md Icebox section for:

- Character Card Import (V2/V3 PNG metadata)
- Lorebooks / Sticky Context
- Multi-personality per channel (Natural Order)

See "Agentic Scaffolding" in Later section for skill/tool architecture.
