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
  type ActionRowBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type {
  DiagnosticPayload,
  DiagnosticMemoryEntry,
} from '@tzurot/common-types/types/diagnostic';
import type { ViewContext } from './viewContext.js';
import { escapeFenceBreaks } from '../../utils/fenceEscape.js';
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
  /** Long-form TEXT rendered inline via chunked ephemeral replies (owner
   * decision: no file-download dance for readable content — files are for
   * structured data like JSON/XML only). The dispatcher hands this to
   * `sendChunkedReply`; `components` ride the first chunk. */
  chunkedText?: { text: string; continuedHeader: string };
  embeds?: EmbedBuilder[];
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
        '🔒 **Character card hidden** — this character is owned by another user.\n\n' +
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

/**
 * Reasoning content, always inline — chunked across ephemeral messages when
 * long (owner decision: reading text must never require a file download).
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
  _requestId: string,
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

  return {
    chunkedText: {
      text: `## Reasoning\n\n${thinking}`,
      continuedHeader: '_(reasoning continued)_\n',
    },
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Memory Inspector
// ---------------------------------------------------------------------------

/** Preview budget per row: the whole view must stay one in-place message so
 * the filter buttons keep editing it (chunked follow-ups would go stale on
 * refresh). Full previews live in the JSON views. */
const MEMORY_PREVIEW_MAX = 60;

function formatMemoryRow(
  m: DiagnosticMemoryEntry,
  index: number,
  canViewCharacter: boolean
): string {
  const status = m.includedInPrompt ? '✓ in' : '✗ drop';
  let preview = canViewCharacter ? m.preview.replace(/\s+/g, ' ').trim() : REDACTED_MEMORY_PREVIEW;
  if (preview.length > MEMORY_PREVIEW_MAX) {
    preview = `${preview.slice(0, MEMORY_PREVIEW_MAX - 1)}…`;
  }
  // Escape AFTER truncation: a cut can split ``` into a harmless ``, and any
  // surviving run still gets neutralized before entering the fence.
  preview = escapeFenceBreaks(preview);
  // Score pads to 5 to align under the 'Score' header label
  return `${String(index + 1).padStart(2)} ${m.score.toFixed(2).padEnd(5)} ${status.padEnd(6)} ${preview}`;
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
    lines.push('🔒 _Memory previews redacted — this character is owned by another user._');
  }
  // Fixed-width rows in a code fence — Discord doesn't render markdown
  // tables, and the fence keeps columns aligned on mobile.
  lines.push('', '```', ' # Score Status Preview');
  for (let i = 0; i < memories.length; i++) {
    lines.push(formatMemoryRow(memories[i], i, canViewCharacter));
  }
  lines.push('```', '');
  lines.push(
    `**Token Budget:** ${tokenBudget.memoryTokensUsed} tokens allocated, ${budgetDropped} memories dropped for budget`
  );
  return lines;
}

/** Trim table rows from the tail until the view fits one Discord message,
 * keeping everything after the closing fence (the token-budget summary line)
 * and appending a notice pointing at Top-N (the existing knob) for narrowing.
 * The view must stay a single in-place message — the filter buttons re-edit
 * it, so spilling into chunked follow-ups would go stale. */
function trimToSingleMessage(content: string): string {
  const limit = 1900; // headroom under Discord's 2000 for the trim notice
  if (content.length <= limit) {
    return content;
  }
  const trimNotice = '_…rows trimmed to fit — lower Top-N or filter to narrow._';
  const fenceEnd = content.lastIndexOf('\n```');
  // Tail = closing fence + the token-budget summary; both must survive the trim.
  const tail = fenceEnd > 0 ? content.slice(fenceEnd) : '';
  let head = fenceEnd > 0 ? content.slice(0, fenceEnd) : content;
  while (head.length + tail.length + trimNotice.length + 1 > limit && head.includes('\n')) {
    head = head.slice(0, head.lastIndexOf('\n'));
  }
  return `${head}${tail}\n${trimNotice}`;
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

  // Single in-place message (owner decision: inline, no file download).
  return {
    content: trimToSingleMessage(lines.join('\n')),
    components: allMemories.length > 0 ? [buildMemoryFilterButtons(requestId, state)] : [],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Token Budget
// ---------------------------------------------------------------------------

/**
 * Context-window allocation as an embed — bars in a code fence for mobile
 * alignment, numbers as fields (owner decision: a text view, not a .txt
 * download). Voice attribution moved to its own view (it was buried here
 * and is about pipeline routing, not token consumption).
 *
 * Token-budget data is purely numeric and contains no character-internal
 * information; the `_ctx` parameter is kept on the signature for uniformity
 * with the other view builders.
 */
export function buildTokenBudgetView(
  payload: DiagnosticPayload,
  _requestId: string,
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

  const bar = (pct: number): string => '█'.repeat(Math.round(pct / 4)).padEnd(25, '░');
  const row = (label: string, tokens: number, pct: number): string =>
    `${label.padEnd(8)}${bar(pct)} ${pct.toFixed(0).padStart(3)}% ${tokens.toLocaleString().padStart(8)}`;

  const chart = [
    '```',
    row('System', tokenBudget.systemPromptTokens, systemPct),
    row('Memory', tokenBudget.memoryTokensUsed, memoryPct),
    row('History', tokenBudget.historyTokensUsed, historyPct),
    row('Free', remaining, remainingPct),
    '```',
  ].join('\n');

  const embed = new EmbedBuilder()
    .setTitle('📊 Token Budget')
    .setColor(historyPct > 70 ? DISCORD_COLORS.WARNING : DISCORD_COLORS.BLURPLE)
    .setDescription(`**Context window:** ${total.toLocaleString()} tokens\n${chart}`);

  const notes: string[] = [];
  if (historyPct > 70) {
    notes.push('⚠️ History is using over 70% of the window.');
  }
  // Cross-channel disclosure: surfaces "0 cross-channel msgs" when the user
  // has crossChannelHistory enabled but the time-filter / personality-history
  // combination produced nothing. Without this line, the silent-skip case is
  // indistinguishable from "feature disabled".
  if (tokenBudget.crossChannelMessagesIncluded !== undefined) {
    notes.push(
      `Cross-channel: ${tokenBudget.crossChannelMessagesIncluded} msgs included from other channels`
    );
  }
  const dropped: string[] = [];
  if (tokenBudget.memoriesDropped > 0) {
    dropped.push(`${tokenBudget.memoriesDropped} memories`);
  }
  if (tokenBudget.historyMessagesDropped > 0) {
    dropped.push(`${tokenBudget.historyMessagesDropped} history messages`);
  }
  if (dropped.length > 0) {
    notes.push(`Dropped for budget: ${dropped.join(', ')}`);
  }
  if (notes.length > 0) {
    embed.addFields({ name: 'Notes', value: notes.join('\n'), inline: false });
  }

  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

// ---------------------------------------------------------------------------
// Voice Attribution
// ---------------------------------------------------------------------------

/**
 * Voice-pipeline routing for this request — extracted from the Token Budget
 * view where it was buried ("that's very unintuitive"). Renders what the
 * payload carries today: the TTS provider that ACTUALLY produced audio (with
 * the silent-fallback annotation) and the voice-message transcript. STT
 * provider attribution isn't in the payload yet — that gap stays tracked in
 * the voice-inspect-ux-polish theme.
 */
export function buildVoiceAttributionView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const { tokenBudget, inputProcessing } = payload;
  const lines: string[] = ['## Voice Attribution', ''];

  const hasTts = tokenBudget.ttsProviderUsed !== undefined;
  const hasTranscript =
    inputProcessing.voiceTranscript !== null && inputProcessing.voiceTranscript.length > 0;

  if (!hasTts && !hasTranscript) {
    return {
      content: 'No voice activity (TTS or voice-message input) on this request.',
      flags: MessageFlags.Ephemeral,
    };
  }

  if (hasTts) {
    // The "(via fallback)" suffix surfaces silent dispatcher fall-throughs
    // where the configured provider failed and a backup produced the audio —
    // the exact diagnostic gap that hid the Mistral STT misattribution.
    const fallbackSuffix = tokenBudget.ttsUsedFallback === true ? ' _(via fallback)_' : '';
    lines.push(`**TTS provider:** ${tokenBudget.ttsProviderUsed}${fallbackSuffix}`);
  }
  if (hasTranscript) {
    // Discord blockquotes need '> ' on EVERY line — a bare continuation line
    // drops out of the quote (unlike GitHub markdown).
    const quoted = (inputProcessing.voiceTranscript ?? '')
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');
    lines.push('', '**Voice transcript:**', quoted);
  }

  return {
    chunkedText: {
      text: lines.join('\n'),
      continuedHeader: '_(voice attribution continued)_\n',
    },
    flags: MessageFlags.Ephemeral,
  };
}
