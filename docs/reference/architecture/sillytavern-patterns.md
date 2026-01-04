# SillyTavern Implementation Patterns

> **Source**: Analysis of SillyTavern codebase (2025-11-24)
> **Purpose**: Implementation reference for Tzurot features inspired by SillyTavern
> **Related Tasks**: Sprint 2 (Task 2.16), Sprint 5 (Tasks 5.4-5.6), Sprint 8, Sprint 9 (Task 9.3)

---

## Table of Contents

1. [Skill System Architecture](#1-skill-system-architecture)
2. [Agentic Loop](#2-agentic-loop)
3. [Web Research Skill](#3-web-research-skill)
4. [Thinking/Reasoning Models](#4-thinkingreasoning-models)
5. [Author's Note (Depth Prompting)](#5-authors-note-depth-prompting)
6. [Response Cleanup (Regex Pipeline)](#6-response-cleanup-regex-pipeline)
7. [Natural Order Group Orchestration](#7-natural-order-group-orchestration)
8. [Lorebooks / World Info](#8-lorebooks--world-info)
9. [Character Card Import](#9-character-card-import)
10. [Local Embeddings](#10-local-embeddings)
11. [Chat Templates](#11-chat-templates)
12. [Slash Command Piping](#12-slash-command-piping)

---

## 1. Skill System Architecture

**Roadmap**: Sprint 5 (Task 5.5), Sprint 8 (Tasks 8.1-8.6)
**SillyTavern Source**: `src/endpoints/backends/tool-calling.js`

### Interface Definition

```typescript
// services/ai-worker/src/skills/interfaces.ts

export interface SkillContext {
  userId: string;
  personalityId: string;
  memoryService: LongTermMemoryService;
  logger: Logger;
}

export interface SkillDefinition {
  /** Unique identifier (e.g., "web_research") */
  name: string;
  /** Description provided to the LLM */
  description: string;
  /** JSON Schema for arguments */
  parameters: Record<string, unknown>;
  /** If true, tool calls hidden from final chat history */
  isStealth?: boolean;
  /** If true, results auto-embedded into vector DB */
  autoMemorize?: boolean;
}

export interface SkillImplementation {
  definition: SkillDefinition;
  execute: (args: unknown, context: SkillContext) => Promise<string>;
}
```

### Registry Pattern

```typescript
// services/ai-worker/src/skills/SkillRegistry.ts

export class SkillRegistry {
  private skills: Map<string, SkillImplementation> = new Map();

  register(skill: SkillImplementation): void {
    this.skills.set(skill.definition.name, skill);
  }

  getDefinitions(): SkillDefinition[] {
    return Array.from(this.skills.values()).map(s => s.definition);
  }

  getImplementation(name: string): SkillImplementation | undefined {
    return this.skills.get(name);
  }
}
```

---

## 2. Agentic Loop

**Roadmap**: Sprint 8 (Task 8.2)
**SillyTavern Source**: `src/endpoints/backends/chat-completions.js` (`invokeFunctionTools`)

### Core Pattern

```typescript
// In ConversationalRAGService.generateResponse()

// 1. Prepare tools for LLM
const tools = this.skillRegistry.getDefinitions().map(s => ({
  type: 'function',
  function: {
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  },
}));

// 2. Initial LLM call
let response = await this.llmInvoker.invokeWithTools(model, messages, tools);

let steps = 0;
const MAX_STEPS = 3; // Prevent infinite loops

// 3. Agentic loop
while (response.tool_calls?.length > 0 && steps < MAX_STEPS) {
  steps++;

  // Add AI's tool call intent to history
  messages.push(response);

  for (const toolCall of response.tool_calls) {
    const skill = this.skillRegistry.getImplementation(toolCall.name);

    if (skill) {
      const result = await skill.execute(JSON.parse(toolCall.args), {
        userId,
        personalityId,
        memoryService,
        logger,
      });

      // Add tool result to history
      messages.push(
        new ToolMessage({
          tool_call_id: toolCall.id,
          content: result,
          name: toolCall.name,
        })
      );
    }
  }

  // Call LLM again with tool results
  response = await this.llmInvoker.invokeWithTools(model, messages, tools);
}

// 4. Return final response (stealth messages NOT saved to DB)
return response.content;
```

### Stealth Handling

For `isStealth: true` skills:

- Tool calls ARE included in `messages` array (LLM context)
- Tool calls are NOT saved to `conversation_history` table
- User only sees the final response

---

## 3. Web Research Skill

**Roadmap**: Sprint 8 (Task 8.4)
**SillyTavern Source**: `src/endpoints/extras/extensions/web-search/index.js`

### Implementation

```typescript
// services/ai-worker/src/skills/definitions/WebResearchSkill.ts

import { search } from 'duck-duck-scrape'; // pnpm add duck-duck-scrape

export const WebResearchSkill: SkillImplementation = {
  definition: {
    name: 'web_research',
    description:
      'Search the internet for current information about media, lore, or events after your training cutoff.',
    isStealth: true,
    autoMemorize: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        focus: {
          type: 'string',
          enum: ['general', 'news', 'wiki'],
          description: 'Content type to prioritize',
        },
      },
      required: ['query'],
    },
  },

  execute: async ({ query, focus }, context) => {
    const results = await search(query, { safeSearch: 0 });

    if (!results.results?.length) {
      return 'No results found.';
    }

    const topResults = results.results.slice(0, 5).map(r => ({
      title: r.title,
      description: r.description,
      url: r.url,
    }));

    const summary =
      `Search Results for "${query}":\n` +
      topResults.map(r => `- [${r.title}](${r.url}): ${r.description}`).join('\n');

    // Auto-memorize (the "learning" step)
    if (context.memoryService) {
      await context.memoryService.storeInteraction(
        { id: context.personalityId },
        `[SYSTEM RESEARCH]: ${query}`,
        `[RESEARCH RESULT]: ${summary}`,
        { userId: context.userId },
        'LORE_RESEARCH' // Tag for filtering
      );
    }

    return summary;
  },
};
```

### Use Case

User asks Alastor about Hazbin Hotel Season 2:

1. LLM realizes it doesn't know → calls `web_research`
2. Backend searches, summarizes results
3. `autoMemorize: true` → embedded into vector DB
4. Next conversation, RAG retrieval finds this memory
5. Character has "learned" about Season 2

---

## 4. Thinking/Reasoning Models

**Roadmap**: Sprint 2 (Task 2.16)
**SillyTavern Source**: `src/endpoints/backends/chat-completions.js`

### Claude Thinking

```typescript
// In LLMInvoker when building request

if (useThinking && Number.isInteger(budgetTokens)) {
  // Minimum buffer for response
  const minThinkTokens = 1024;
  if (requestBody.max_tokens <= minThinkTokens) {
    requestBody.max_tokens += minThinkTokens;
  }

  requestBody.thinking = {
    type: 'enabled',
    budget_tokens: budgetTokens,
  };

  // CRITICAL: Remove sampling parameters (API rejects them with thinking)
  delete requestBody.temperature;
  delete requestBody.top_p;
  delete requestBody.top_k;
}
```

### Gemini Thinking

```typescript
// For Gemini 2.5+ models
if (isGeminiThinkingModel(modelName)) {
  requestBody.generationConfig = {
    ...requestBody.generationConfig,
    thinkingConfig: {
      thinkingBudget: budgetTokens,
    },
  };
}
```

### Output Handling

Strip `<thinking>` tags before saving/displaying:

```typescript
function stripThinkingTags(content: string): string {
  return content.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
}
```

---

## 5. Author's Note (Depth Prompting)

**Roadmap**: Sprint 5 (Task 5.4)
**SillyTavern Source**: `public/scripts/authors-note.js`

### Problem

"Lost in the Middle" syndrome: LLMs pay most attention to beginning and end of context. System prompts at top get forgotten in long conversations.

### Solution

Inject style reminders at variable depth (2-4 messages from bottom):

```typescript
// In PromptBuilder.ts

insertAuthorsNote(
  history: BaseMessage[],
  note: string,
  depth: number = 3
): BaseMessage[] {
  const insertionIndex = Math.max(0, history.length - depth);

  // Insert reminder near recent messages
  history.splice(insertionIndex, 0, new SystemMessage(note));

  return history;
}
```

### Usage

```typescript
// Example: Ensure Alastor maintains radio host style
const authorsNote = 'Remember: Alastor speaks in 1930s radio host style with theatrical flair.';
messages = this.insertAuthorsNote(messages, authorsNote, 3);
```

---

## 6. Response Cleanup (Regex Pipeline)

**Roadmap**: Sprint 5 (Task 5.6)
**SillyTavern Source**: `public/scripts/extensions/regex/engine.js`
**Current Tzurot**: `services/ai-worker/src/utils/responseCleanup.ts`

### Existing Pattern (Expand This)

```typescript
// Current: stripResponseArtifacts() removes XML tags and legacy prefixes
// Expand to configurable pipeline:

interface RegexRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  enabled: boolean;
  /** Apply to specific personalities or globally */
  scope: 'global' | string[];
}

const defaultRules: RegexRule[] = [
  {
    name: 'strip_personality_prefix',
    pattern: /^[\w\s]+:\s*\[.*?\]\s*/,
    replacement: '',
    enabled: true,
    scope: 'global',
  },
  {
    name: 'strip_thinking_tags',
    pattern: /<thinking>[\s\S]*?<\/thinking>/gi,
    replacement: '',
    enabled: true,
    scope: 'global',
  },
  {
    name: 'italicize_actions',
    pattern: /\*([^*]+)\*/g,
    replacement: '_$1_', // Discord italic format
    enabled: false,
    scope: 'global',
  },
];

function applyRegexPipeline(content: string, rules: RegexRule[], personalityId?: string): string {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.scope !== 'global' && !rule.scope.includes(personalityId)) continue;
    content = content.replace(rule.pattern, rule.replacement);
  }
  return content;
}
```

---

## 7. Natural Order Group Orchestration

**Roadmap**: Sprint 9 (Task 9.3)
**SillyTavern Source**: `public/scripts/group-chats.js` (`activateNaturalOrder`)

### Deterministic Speaker Selection

```typescript
interface Character {
  id: string;
  name: string;
  talkativeness: number; // 0-1, default 0.5
}

function selectNextSpeaker(
  candidates: Character[],
  userMessage: string,
  lastSpeakerId: string,
  allowSelfResponse: boolean = false
): string | null {
  const inputWords = tokenize(userMessage.toLowerCase());

  // 1. Direct mention wins
  for (const char of candidates) {
    if (!allowSelfResponse && char.id === lastSpeakerId) continue;

    const nameWords = tokenize(char.name.toLowerCase());
    if (nameWords.some(word => inputWords.includes(word))) {
      return char.id;
    }
  }

  // 2. Talkativeness RNG
  const shuffled = shuffle(candidates);
  for (const char of shuffled) {
    if (!allowSelfResponse && char.id === lastSpeakerId) continue;

    if (Math.random() < char.talkativeness) {
      return char.id;
    }
  }

  return null; // No one wants to speak
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(w => w.length > 2);
}
```

### Benefits

- No LLM router call needed (saves tokens)
- Deterministic behavior for testing
- Organic conversation flow via RNG

---

## 8. Lorebooks / World Info

**Roadmap**: Icebox (complements OpenMemory)
**SillyTavern Source**: `public/scripts/world-info.js`

### Concept

- **Vector RAG**: Probabilistic ("87% relevant")
- **Lorebooks**: Deterministic ("if keyword X, inject lore Y")

Use lorebooks for critical facts that MUST be present.

### Data Structure

```typescript
interface LoreEntry {
  id: string;
  keywords: string[]; // Primary triggers
  secondaryKeywords?: string[]; // Filter keywords
  selectiveLogic?: 'AND_ANY' | 'NOT_ANY' | 'AND_ALL' | 'NOT_ALL';
  content: string;
  sticky?: number; // Stay active for N turns after trigger
  cooldown?: number; // Can't retrigger for N turns
  priority: number; // Insertion order
}

interface TimedEffect {
  entryId: string;
  turnsRemaining: number;
}
```

### Logic Gates

```typescript
function shouldActivate(
  entry: LoreEntry,
  inputWords: string[],
  activeEffects: TimedEffect[]
): boolean {
  // Check sticky effects first
  const stickyEffect = activeEffects.find(e => e.entryId === entry.id);
  if (stickyEffect && stickyEffect.turnsRemaining > 0) {
    return true;
  }

  // Primary keyword check
  const hasPrimary = entry.keywords.some(k => inputWords.includes(k.toLowerCase()));
  if (!hasPrimary) return false;

  // Secondary keyword logic
  if (!entry.secondaryKeywords?.length) return true;

  const hasSecondary = entry.secondaryKeywords.some(k => inputWords.includes(k.toLowerCase()));

  switch (entry.selectiveLogic) {
    case 'AND_ANY':
      return hasSecondary;
    case 'NOT_ANY':
      return !hasSecondary;
    case 'AND_ALL':
      return entry.secondaryKeywords.every(k => inputWords.includes(k.toLowerCase()));
    case 'NOT_ALL':
      return !entry.secondaryKeywords.every(k => inputWords.includes(k.toLowerCase()));
    default:
      return true;
  }
}
```

### Use Case

Entry: "Evil King" (keywords: ["king"], secondaryKeywords: ["throne room"], logic: AND_ANY)

- User says "Tell me about the king" in throne room → Entry activates
- User says "Tell me about the king" elsewhere → Entry doesn't activate

---

## 9. Character Card Import

**Roadmap**: Icebox
**SillyTavern Source**: `src/character-card-parser.js`

### PNG Metadata Reading

```typescript
// pnpm add png-chunks-extract png-chunk-text

import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

export function parseCharacterCard(imageBuffer: Buffer): CharacterData {
  const chunks = extract(new Uint8Array(imageBuffer));
  const textChunks = chunks
    .filter(chunk => chunk.name === 'tEXt')
    .map(chunk => PNGtext.decode(chunk.data));

  // V3 spec (ccv3) takes precedence
  const ccv3 = textChunks.find(c => c.keyword.toLowerCase() === 'ccv3');
  if (ccv3) {
    return JSON.parse(Buffer.from(ccv3.text, 'base64').toString('utf8'));
  }

  // Fallback to V2 (chara)
  const chara = textChunks.find(c => c.keyword.toLowerCase() === 'chara');
  if (chara) {
    return JSON.parse(Buffer.from(chara.text, 'base64').toString('utf8'));
  }

  throw new Error('No character metadata found in image');
}
```

### Character Data Mapping

Map V2/V3 fields to Tzurot Personality schema:

- `name` → `Personality.name`
- `description` → `Personality.systemPrompt` (partial)
- `personality` → `Personality.systemPrompt` (partial)
- `scenario` → `Personality.systemPrompt` (partial)
- `first_mes` → Initial greeting (optional)
- `avatar` → Use the PNG itself

---

## 10. Local Embeddings

**Roadmap**: Icebox
**SillyTavern Source**: `src/vectors/embedding.js`

### Transformers.js Implementation

```typescript
// pnpm add @xenova/transformers

import { pipeline } from '@xenova/transformers';

let embeddingPipeline: any = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2' // Or other sentence-transformers model
    );
  }
  return embeddingPipeline;
}

export async function getLocalEmbedding(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  const result = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}
```

### Benefits

- No OpenAI API costs for embeddings
- Lower latency (local computation)
- Works offline

### Considerations

- Model size (~90MB for MiniLM)
- First call is slow (model loading)
- Embedding dimensions must match existing pgvector index

---

## 11. Chat Templates

**Roadmap**: Icebox (local model support)
**SillyTavern Source**: `public/scripts/chat-templates.js`

### Template Auto-Detection

SillyTavern hashes the model's `chat_template` to identify format:

```typescript
const TEMPLATE_HASHES: Record<string, string> = {
  llama3: 'abc123...',
  'mistral-v3': 'def456...',
  chatml: 'ghi789...',
  // etc.
};

function detectTemplate(chatTemplateString: string): string {
  const hash = md5(chatTemplateString);
  return TEMPLATE_HASHES[hash] || 'chatml'; // Default fallback
}
```

### Instruct Presets

```typescript
interface InstructPreset {
  name: string;
  system_sequence: string;
  input_sequence: string; // User prefix
  output_sequence: string; // Assistant prefix
  separator: string;
  stop_sequence: string[];
}

const LLAMA3_PRESET: InstructPreset = {
  name: 'llama3',
  system_sequence: '<|start_header_id|>system<|end_header_id|>\n\n',
  input_sequence: '<|start_header_id|>user<|end_header_id|>\n\n',
  output_sequence: '<|start_header_id|>assistant<|end_header_id|>\n\n',
  separator: '<|eot_id|>',
  stop_sequence: ['<|eot_id|>', '<|end_of_text|>'],
};
```

---

## 12. Slash Command Piping

**Roadmap**: Icebox
**SillyTavern Source**: `public/scripts/slash-commands.js`

### Concept

Chain commands with pipe operator:

```
/websearch "Hazbin Hotel Season 2" | /summarize | /inject
```

### Implementation Sketch

```typescript
async function executeCommandPipeline(input: string, context: CommandContext): Promise<string> {
  const commands = input.split('|').map(c => c.trim());
  let result = '';

  for (const cmd of commands) {
    const { name, args } = parseCommand(cmd);
    const handler = commandRegistry.get(name);

    if (!handler) {
      throw new Error(`Unknown command: ${name}`);
    }

    // Previous result becomes input for next command
    result = await handler.execute(args, result, context);
  }

  return result;
}
```

---

## Quick Reference: What Goes Where

| Feature           | Sprint | Task | Priority     |
| ----------------- | ------ | ---- | ------------ |
| Skill Interface   | 5      | 5.5  | Foundation   |
| Regex Pipeline    | 5      | 5.6  | Foundation   |
| Author's Note     | 5      | 5.4  | Quick Win    |
| Thinking Models   | 2      | 2.16 | BYOK Support |
| Skill Registry    | 8      | 8.1  | Agentic Core |
| Agentic Loop      | 8      | 8.2  | Agentic Core |
| Stealth Reasoning | 8      | 8.3  | Agentic Core |
| Web Research      | 8      | 8.4  | Key Feature  |
| URL Scraper       | 8      | 8.5  | Key Feature  |
| Natural Order     | 9      | 9.3  | Group Chats  |
| Lorebooks         | Icebox | -    | OpenMemory+  |
| Character Cards   | Icebox | -    | Community    |
| Local Embeddings  | Icebox | -    | Cost Savings |
| Chat Templates    | Icebox | -    | Local Models |
| Command Piping    | Icebox | -    | Power Users  |
