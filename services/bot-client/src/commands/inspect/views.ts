/**
 * View builders for each diagnostic output format
 *
 * Each view returns either an ephemeral message payload or a file attachment.
 *
 * View builders take a {@link ViewContext} so they can redact character
 * internals (system prompt, memory previews) when the inspecting user does
 * not own the personality the diagnostic log was generated against. See
 * `viewContext.ts` for the ownership-resolution logic.
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { DiagnosticPayload, DiagnosticMemoryEntry } from '@tzurot/common-types';
import type { ViewContext } from './viewContext.js';
import {
  DEFAULT_MEMORY_STATE,
  applyMemoryFilter,
  applySort,
  applyTopN,
  buildMemoryFilterButtons,
  type MemoryInspectorState,
} from './memoryInspectorState.js';

/** Return type for view builders — content string, file attachments, and optional component rows. */
export interface DebugViewResult {
  content?: string;
  files?: AttachmentBuilder[];
  flags?: MessageFlags;
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Sentinel string used in JSON views to redact a system-prompt message body */
const REDACTED_SYSTEM_PROMPT = '[REDACTED — character card hidden for non-owner]';
/** Sentinel string used in JSON / Memory Inspector views to redact a memory preview */
const REDACTED_MEMORY_PREVIEW = '[REDACTED]';

// ---------------------------------------------------------------------------
// Full JSON
// ---------------------------------------------------------------------------

/** Apply non-owner redactions to a full DiagnosticPayload (system prompt + memory previews) */
function redactPayloadForNonOwner(payload: DiagnosticPayload): DiagnosticPayload {
  return {
    ...payload,
    assembledPrompt: {
      ...payload.assembledPrompt,
      messages: payload.assembledPrompt.messages.map(msg =>
        msg.role === 'system' ? { ...msg, content: REDACTED_SYSTEM_PROMPT } : msg
      ),
    },
    memoryRetrieval: {
      ...payload.memoryRetrieval,
      memoriesFound: payload.memoryRetrieval.memoriesFound.map(m => ({
        ...m,
        preview: REDACTED_MEMORY_PREVIEW,
      })),
    },
  };
}

/** Complete DiagnosticPayload as a .json file */
export function buildFullJsonView(
  payload: DiagnosticPayload,
  requestId: string,
  ctx: ViewContext
): DebugViewResult {
  const effectivePayload = ctx.canViewCharacter ? payload : redactPayloadForNonOwner(payload);
  const jsonContent = JSON.stringify(effectivePayload, null, 2);
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
 *
 * For non-owners, memory previews are also redacted (the system-prompt summary
 * is non-leaking so it stays as-is).
 */
export function buildCompactJsonView(
  payload: DiagnosticPayload,
  requestId: string,
  ctx: ViewContext
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
    preview: ctx.canViewCharacter
      ? m.preview.length > 100
        ? m.preview.substring(0, 100) + '...'
        : m.preview
      : REDACTED_MEMORY_PREVIEW,
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
  requestId: string,
  ctx: ViewContext
): DebugViewResult {
  if (!ctx.canViewCharacter) {
    // No `flags` field: editReply cannot change ephemeral state set on the
    // initial defer. The /inspect command defers ephemeral, so all view
    // results inherit that automatically.
    return {
      content:
        '🔒 **Character card hidden** — this personality is owned by another user.\n\n' +
        'Numeric and timing diagnostics remain visible above.',
    };
  }

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

/**
 * Reasoning content as either inline markdown or a .md file.
 *
 * Reasoning content is shown to non-owners by design (per project decision —
 * model thinking is genuinely interesting and the user already saw the
 * response anyway; redacting reasoning would not actually close the system-
 * prompt leak path because prompt-injection attacks bypass it). The
 * `_ctx` parameter is kept on the signature for uniformity with the
 * other view builders.
 */
export function buildReasoningView(
  payload: DiagnosticPayload,
  requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
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

function formatMemoryRow(
  m: DiagnosticMemoryEntry,
  index: number,
  canViewCharacter: boolean
): string {
  const status = m.includedInPrompt ? 'Included' : 'Dropped (budget)';
  const preview = canViewCharacter
    ? m.preview.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    : REDACTED_MEMORY_PREVIEW;
  return `| ${index + 1} | ${m.score.toFixed(2)} | ${status} | ${preview} |`;
}

function renderMemoryTable(
  memories: readonly DiagnosticMemoryEntry[],
  allMemories: readonly DiagnosticMemoryEntry[],
  tokenBudget: { memoryTokensUsed: number },
  canViewCharacter: boolean
): string[] {
  const includedTotal = allMemories.filter(m => m.includedInPrompt).length;
  // Budget drops happened over the full unfiltered retrieval, not the filtered view —
  // hence allMemories rather than memories. Variable name is explicit to avoid
  // confusion with filter-induced row exclusion.
  const budgetDropped = allMemories.length - includedTotal;
  const lines = [
    `## Retrieved Memories (${allMemories.length} total, ${includedTotal} included, showing ${memories.length})`,
  ];
  if (!canViewCharacter) {
    lines.push('');
    lines.push('🔒 _Memory previews redacted — this personality is owned by another user._');
  }
  lines.push('', '| # | Score | Status | Preview |', '|---|-------|--------|---------|');
  for (let i = 0; i < memories.length; i++) {
    lines.push(formatMemoryRow(memories[i], i, canViewCharacter));
  }
  lines.push('');
  lines.push(
    `**Token Budget:** ${tokenBudget.memoryTokensUsed} tokens allocated, ${budgetDropped} memories dropped for budget`
  );
  return lines;
}

/** Scored memories table with inclusion status. Applies filter → sort → Top-N. */
export function buildMemoryInspectorView(
  payload: DiagnosticPayload,
  requestId: string,
  ctx: ViewContext,
  state: MemoryInspectorState = DEFAULT_MEMORY_STATE
): DebugViewResult {
  const { memoryRetrieval, inputProcessing, tokenBudget } = payload;
  const allMemories = memoryRetrieval.memoriesFound;
  const filtered = applyMemoryFilter(allMemories, state.filter);
  const sorted = applySort(filtered, state.sort);
  const memories = applyTopN(sorted, state.topN);

  const lines: string[] = [
    '# Memory Inspector',
    '',
    `**Search Query:** ${inputProcessing.searchQuery !== null ? `"${inputProcessing.searchQuery}"` : '_none_'}`,
    `**Focus Mode:** ${memoryRetrieval.focusModeEnabled ? 'Enabled' : 'Disabled'}`,
  ];

  // State annotation and filter buttons only make sense when there's something
  // to filter — omit both when the underlying retrieval was empty.
  if (allMemories.length === 0) {
    lines.push('', '_No memories retrieved for this request._');
  } else {
    lines.push(
      `**Filter:** ${state.filter} · **Sort:** ${state.sort} · **Top-N:** ${state.topN === 0 ? 'all' : state.topN}`,
      ''
    );
    if (memories.length === 0) {
      lines.push(`_No memories match filter "${state.filter}"._`);
    } else {
      lines.push(...renderMemoryTable(memories, allMemories, tokenBudget, ctx.canViewCharacter));
    }
  }

  const content = lines.join('\n');
  return {
    files: [
      new AttachmentBuilder(Buffer.from(content), {
        name: `memory-inspector-${requestId}.md`,
        description: 'Memory retrieval details',
      }),
    ],
    components: allMemories.length > 0 ? [buildMemoryFilterButtons(requestId, state)] : [],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Token Budget
// ---------------------------------------------------------------------------

/**
 * ASCII breakdown of context window allocation.
 *
 * Token-budget data is purely numeric and contains no character-internal
 * information; the `_ctx` parameter is kept on the signature for uniformity
 * with the other view builders.
 */
export function buildTokenBudgetView(
  payload: DiagnosticPayload,
  requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
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
    return '█'.repeat(blocks);
  };

  const warn = (pct: number): string => (pct > 70 ? '  ⚠️ >70%' : '');

  const pad = (label: string): string => label.padEnd(16);

  const lines = [
    'Token Budget Breakdown',
    '═'.repeat(40),
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
