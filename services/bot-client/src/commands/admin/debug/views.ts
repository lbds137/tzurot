/**
 * View builders for each debug output format
 *
 * Each view returns either an ephemeral message payload or a file attachment.
 */

import { AttachmentBuilder, MessageFlags } from 'discord.js';
import type { DiagnosticPayload } from '@tzurot/common-types';

/** Return type for view builders — either a content string or file attachments */
export interface DebugViewResult {
  content?: string;
  files?: AttachmentBuilder[];
  flags?: MessageFlags;
}

// ---------------------------------------------------------------------------
// Full JSON
// ---------------------------------------------------------------------------

/** Complete DiagnosticPayload as a .json file */
export function buildFullJsonView(payload: DiagnosticPayload, requestId: string): DebugViewResult {
  const jsonContent = JSON.stringify(payload, null, 2);
  return {
    files: [
      new AttachmentBuilder(Buffer.from(jsonContent), {
        name: `debug-${requestId}.json`,
        description: 'Full LLM debug data for prompt analysis',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Compact JSON
// ---------------------------------------------------------------------------

/**
 * JSON with system prompt content replaced by a length summary,
 * memory previews truncated, embeddings stripped. User/assistant messages intact.
 */
export function buildCompactJsonView(
  payload: DiagnosticPayload,
  requestId: string
): DebugViewResult {
  const { assembledPrompt, ...rest } = payload;

  const compactMessages = assembledPrompt.messages.map(msg => {
    if (msg.role === 'system') {
      return {
        role: msg.role,
        content: `[system prompt: ${msg.content.length} chars]`,
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const compactMemories = payload.memoryRetrieval.memoriesFound.map(m => ({
    ...m,
    preview: m.preview.length > 100 ? m.preview.substring(0, 100) + '...' : m.preview,
  }));

  const compactPayload = {
    ...rest,
    memoryRetrieval: {
      ...payload.memoryRetrieval,
      memoriesFound: compactMemories,
    },
    assembledPrompt: {
      messages: compactMessages,
      totalTokenEstimate: assembledPrompt.totalTokenEstimate,
    },
  };

  const jsonContent = JSON.stringify(compactPayload, null, 2);
  return {
    files: [
      new AttachmentBuilder(Buffer.from(jsonContent), {
        name: `debug-compact-${requestId}.json`,
        description: 'Compact LLM debug data (system prompt summarized)',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// System Prompt (XML)
// ---------------------------------------------------------------------------

/** Extract and format the system prompt as XML */
export function buildSystemPromptView(
  payload: DiagnosticPayload,
  requestId: string
): DebugViewResult {
  const systemMessage = payload.assembledPrompt.messages.find(m => m.role === 'system');
  const xmlContent =
    systemMessage !== undefined
      ? `<SystemPrompt>\n${systemMessage.content}\n</SystemPrompt>`
      : '<SystemPrompt>\n  <!-- No system message found -->\n</SystemPrompt>';

  return {
    files: [
      new AttachmentBuilder(Buffer.from(xmlContent), {
        name: `system-prompt-${requestId}.xml`,
        description: 'Formatted system prompt for analysis',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

/** Discord message content limit; reasoning longer than this is sent as a .md file attachment */
const REASONING_INLINE_LIMIT = 2000;

/** Reasoning content as either inline markdown or a .md file */
export function buildReasoningView(payload: DiagnosticPayload, requestId: string): DebugViewResult {
  const thinking = payload.postProcessing.thinkingContent;

  if (thinking === null || thinking.length === 0) {
    return {
      content: 'No reasoning content captured for this request.',
      flags: MessageFlags.Ephemeral,
    };
  }

  const formatted = `## Reasoning\n\n${thinking}`;

  if (formatted.length < REASONING_INLINE_LIMIT) {
    return {
      content: formatted,
      flags: MessageFlags.Ephemeral,
    };
  }

  return {
    content: `Reasoning content (${thinking.length.toLocaleString()} chars) attached as file:`,
    files: [
      new AttachmentBuilder(Buffer.from(formatted), {
        name: `reasoning-${requestId}.md`,
        description: 'LLM reasoning / thinking content',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Memory Inspector
// ---------------------------------------------------------------------------

/** Scored memories table with inclusion status */
export function buildMemoryInspectorView(
  payload: DiagnosticPayload,
  requestId: string
): DebugViewResult {
  const { memoryRetrieval, inputProcessing, tokenBudget } = payload;
  const memories = memoryRetrieval.memoriesFound;

  const lines: string[] = [
    '# Memory Inspector',
    '',
    `**Search Query:** ${inputProcessing.searchQuery !== null ? `"${inputProcessing.searchQuery}"` : '_none_'}`,
    `**Focus Mode:** ${memoryRetrieval.focusModeEnabled ? 'Enabled' : 'Disabled'}`,
    '',
  ];

  if (memories.length === 0) {
    lines.push('_No memories retrieved for this request._');
  } else {
    const included = memories.filter(m => m.includedInPrompt).length;
    const dropped = memories.length - included;

    lines.push(`## Retrieved Memories (${memories.length} found, ${included} included)`);
    lines.push('');
    lines.push('| # | Score | Status | Preview |');
    lines.push('|---|-------|--------|---------|');

    for (let i = 0; i < memories.length; i++) {
      const m = memories[i];
      const status = m.includedInPrompt ? 'Included' : 'Dropped (budget)';
      const preview = m.preview.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${i + 1} | ${m.score.toFixed(2)} | ${status} | ${preview} |`);
    }

    lines.push('');
    lines.push(
      `**Token Budget:** ${tokenBudget.memoryTokensUsed} tokens allocated, ${dropped} memories dropped for budget`
    );
  }

  const content = lines.join('\n');
  return {
    files: [
      new AttachmentBuilder(Buffer.from(content), {
        name: `memory-inspector-${requestId}.md`,
        description: 'Memory retrieval details',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Token Budget
// ---------------------------------------------------------------------------

/** ASCII breakdown of context window allocation */
export function buildTokenBudgetView(
  payload: DiagnosticPayload,
  requestId: string
): DebugViewResult {
  const { tokenBudget } = payload;
  const total = tokenBudget.contextWindowSize || 1;

  const systemPct = (tokenBudget.systemPromptTokens / total) * 100;
  const memoryPct = (tokenBudget.memoryTokensUsed / total) * 100;
  const historyPct = (tokenBudget.historyTokensUsed / total) * 100;
  const usedTokens =
    tokenBudget.systemPromptTokens + tokenBudget.memoryTokensUsed + tokenBudget.historyTokensUsed;
  const remaining = Math.max(0, total - usedTokens);
  const remainingPct = (remaining / total) * 100;

  const bar = (pct: number): string => {
    const blocks = Math.round(pct / 2.5);
    return '\u2588'.repeat(blocks);
  };

  const warn = (pct: number): string => (pct > 70 ? '  \u26a0\ufe0f >70%' : '');

  const pad = (label: string): string => label.padEnd(16);

  const lines = [
    'Token Budget Breakdown',
    '\u2550'.repeat(40),
    `Context Window: ${total.toLocaleString()} tokens`,
    '',
    `  ${pad('System Prompt:')}${tokenBudget.systemPromptTokens.toLocaleString().padStart(8)} tokens (${systemPct.toFixed(0).padStart(2)}%)  ${bar(systemPct)}`,
    `  ${pad('Memory:')}${tokenBudget.memoryTokensUsed.toLocaleString().padStart(8)} tokens (${memoryPct.toFixed(0).padStart(2)}%)  ${bar(memoryPct)}`,
    `  ${pad('History:')}${tokenBudget.historyTokensUsed.toLocaleString().padStart(8)} tokens (${historyPct.toFixed(0).padStart(2)}%)  ${bar(historyPct)}${warn(historyPct)}`,
    `  ${'─── Available ───'.padEnd(40, '─')}`,
    `  ${pad('Remaining:')}${remaining.toLocaleString().padStart(8)} tokens (${remainingPct.toFixed(0).padStart(2)}%)`,
  ];

  const dropped: string[] = [];
  if (tokenBudget.memoriesDropped > 0) {
    dropped.push(`${tokenBudget.memoriesDropped} memories`);
  }
  if (tokenBudget.historyMessagesDropped > 0) {
    dropped.push(`${tokenBudget.historyMessagesDropped} history messages`);
  }
  if (dropped.length > 0) {
    lines.push('');
    lines.push(`Dropped: ${dropped.join(', ')}`);
  }

  const content = lines.join('\n');
  return {
    files: [
      new AttachmentBuilder(Buffer.from(content), {
        name: `token-budget-${requestId}.txt`,
        description: 'Token budget breakdown',
      }),
    ],
    flags: MessageFlags.Ephemeral,
  };
}
