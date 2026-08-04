// Extracted from views.ts to stay under the 400-line ESLint limit.

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { UX_SENTINELS } from '@tzurot/common-types/constants/uxVocabulary';
import type {
  DiagnosticPayload,
  DiagnosticPromptSection,
  PipelineStep,
} from '@tzurot/common-types/types/diagnostic';
import type { ViewContext } from './viewContext.js';
import type { DebugViewResult } from './views.js';
import { escapeFenceBreaks } from '../../utils/fenceEscape.js';

// ---------------------------------------------------------------------------
// Pipeline Health
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<PipelineStep['status'], string> = {
  success: '✅',
  skipped: '⏭️',
  error: '❌',
};

/** Two lines per step (emoji-status + indented reason) — no fixed-width
 * columns means no fence, so emoji glyph-width can't skew alignment on
 * mobile and step names never truncate. */
function renderStepRows(steps: readonly PipelineStep[]): string[] {
  const rows: string[] = [];
  for (const step of steps) {
    const icon = STATUS_ICON[step.status];
    // Reasons can carry model/content-derived text — a ``` inside one would
    // open a code block mid-description; keep the neutralizer.
    const reason = escapeFenceBreaks(step.reason ?? '—');
    rows.push(`${icon} \`${step.name}\``);
    rows.push(`-# ${reason}`);
  }
  return rows;
}

function renderLegacyTransforms(transformsApplied: readonly string[]): string[] {
  const rows = [
    '_This log predates structured pipeline step tracking. Showing legacy transforms._',
    '',
  ];
  if (transformsApplied.length === 0) {
    rows.push('_No transforms applied._');
  } else {
    for (const name of transformsApplied) {
      rows.push(`- ✅ \`${name}\``);
    }
  }
  return rows;
}

/** Post-processing pipeline outcomes as an informational embed. */
export function buildPipelineHealthView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const steps = payload.postProcessing.pipelineSteps;
  const lines: string[] = [];

  if (steps === undefined) {
    lines.push(...renderLegacyTransforms(payload.postProcessing.transformsApplied));
  } else if (steps.length === 0) {
    lines.push('_No pipeline steps recorded._');
  } else {
    lines.push(...renderStepRows(steps));
  }

  const { finalContent, thinkingContent, artifactsStripped } = payload.postProcessing;
  const thinkingLabel =
    thinkingContent !== null
      ? `${thinkingContent.length.toLocaleString()} chars`
      : UX_SENTINELS.NOT_SET;
  const artifactsLabel =
    artifactsStripped.length > 0 ? artifactsStripped.join(', ') : UX_SENTINELS.NOT_SET;

  // Informational surface: BLURPLE always (design system). The step list has
  // a hard practical bound (a handful of pipeline stages), so the 4096
  // description cap is never in play.
  const embed = new EmbedBuilder()
    .setTitle('🩺 Pipeline Health')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(lines.join('\n'))
    .addFields({
      name: 'Content',
      value: `**Final:** ${finalContent.length.toLocaleString()} chars · **Thinking:** ${thinkingLabel}\n**Artifacts stripped:** ${artifactsLabel}`,
      inline: false,
    });

  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Section with a heading, or nothing when the data is absent. */
function inputSection(heading: string, body: string | null): string[] {
  if (body === null || body.length === 0) {
    return [];
  }
  return [`### ${heading}`, body, ''];
}

/**
 * Everything the pipeline INGESTED for this request: the raw user message,
 * attachment descriptions, voice transcript, and referenced-message content.
 * Long-form text → chunked (capped, overflow as attachment). No extra
 * redaction: this is the log's own input, already fully exposed in the
 * Full JSON view under the same server-side per-user access gate.
 */
export function buildInputView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const input = payload.inputProcessing;

  const attachments =
    input.attachmentDescriptions.length > 0
      ? input.attachmentDescriptions.map((d, i) => `${i + 1}. ${escapeFenceBreaks(d)}`).join('\n')
      : null;

  const referenced =
    input.referencedMessagesContent.length > 0
      ? input.referencedMessagesContent
          .map((content, i) => {
            const id = input.referencedMessageIds[i];
            const idLabel = id !== undefined ? ` (\`${id}\`)` : '';
            return `**Reply ${i + 1}**${idLabel}\n${escapeFenceBreaks(content)}`;
          })
          .join('\n\n')
      : null;

  const sections = [
    '## Input',
    '',
    ...inputSection('Raw user message', escapeFenceBreaks(input.rawUserMessage)),
    ...inputSection(`Attachments (${input.attachmentDescriptions.length})`, attachments),
    // Transcript and search query are content-derived too (the query is
    // built straight from the user's message) — same fence discipline.
    ...inputSection(
      'Voice transcript',
      input.voiceTranscript !== null ? escapeFenceBreaks(input.voiceTranscript) : null
    ),
    ...inputSection('Referenced messages', referenced),
    ...inputSection(
      'Memory search query',
      input.searchQuery !== null ? escapeFenceBreaks(input.searchQuery) : null
    ),
  ];

  return {
    chunkedText: {
      text: sections.join('\n'),
      continuedHeader: '_(input continued)_\n',
      maxChunks: 3,
      overflowFilename: 'input-full.txt',
    },
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Generation Params
// ---------------------------------------------------------------------------

/** The named sampling knobs, rendered only when set. */
const NAMED_PARAMS = [
  ['temperature', 'Temperature'],
  ['topP', 'Top-p'],
  ['topK', 'Top-k'],
  ['maxTokens', 'Max tokens'],
  ['frequencyPenalty', 'Frequency penalty'],
  ['presencePenalty', 'Presence penalty'],
  ['repetitionPenalty', 'Repetition penalty'],
] as const;

/**
 * The full generation configuration: model/provider, the named sampling
 * knobs, and the complete `allParams` record (which carries the long tail —
 * seed, minP, reasoning config, transforms…).
 */
export function buildGenerationParamsView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const config = payload.llmConfig;

  const named = NAMED_PARAMS.map(([key, label]) => {
    const value = config[key];
    return value !== undefined ? `**${label}:** ${value}` : null;
  }).filter((line): line is string => line !== null);

  const embed = new EmbedBuilder()
    .setTitle('🎛️ Generation Params')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(
      [
        `**Model:** \`${escapeFenceBreaks(config.model)}\``,
        `**Provider:** ${config.provider}`,
        '',
        ...(named.length > 0 ? named : ['_No sampling overrides set._']),
      ].join('\n')
    );

  // Field values cap at 1024 — measure the RENDERED string (escaping can
  // lengthen it), and past the cap the record is genuinely long-tail
  // config: point at Full JSON rather than truncating mid-object.
  const allParamsRendered = `\`\`\`json\n${escapeFenceBreaks(
    JSON.stringify(config.allParams, null, 2)
  )}\n\`\`\``;
  embed.addFields({
    name: 'All params',
    value:
      allParamsRendered.length <= 1024
        ? allParamsRendered
        : '_Too long to inline — see the Full JSON view (`llmConfig.allParams`)._',
    inline: false,
  });

  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}

// ---------------------------------------------------------------------------
// Post-Processing (before/after)
// ---------------------------------------------------------------------------

/**
 * The model's raw output next to the final content that shipped, so a
 * post-processing mangle (or a stripped artifact) is visible side by side.
 */
export function buildPostProcessingView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const raw = payload.llmResponse.rawContent;
  const final = payload.postProcessing.finalContent;

  const identical = raw === final;
  const sections = identical
    ? [
        '## Post-Processing',
        '',
        '_Raw output and final content are identical — post-processing changed nothing._',
        '',
        '### Content',
        escapeFenceBreaks(final),
      ]
    : [
        '## Post-Processing',
        '',
        `### Raw model output (${raw.length.toLocaleString()} chars)`,
        escapeFenceBreaks(raw),
        '',
        `### Final after post-processing (${final.length.toLocaleString()} chars)`,
        escapeFenceBreaks(final),
      ];

  return {
    chunkedText: {
      text: sections.join('\n'),
      continuedHeader: '_(post-processing continued)_\n',
      maxChunks: 3,
      overflowFilename: 'post-processing-full.txt',
    },
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Cache
//
// The summary embed carries cached-token counts as two lines; this view has
// room for the full picture: cached-vs-total prompt tokens with a hit bar, the
// provider's billing discount when reported, and the per-section prefix map so
// a cache miss can be localized to the section that changed.
// ---------------------------------------------------------------------------

/** Section-id budget per row — sized for the narrower monospace width embeds
 * get on mobile (~38 chars/row including tier, chars, and offset columns). */
const SECTION_ID_MAX = 17;

/** Headroom under Discord's 4096 embed-description cap. */
const DESCRIPTION_LIMIT = 3900;

/** Heading shared by every prefix-map render state. */
const PREFIX_MAP_HEADING = '**Prefix map**';

/** 15-cell bar, matching the Token Budget view's mobile-safe width. */
function bar(pct: number): string {
  return '█'.repeat(Math.round(pct / (100 / 15))).padEnd(15, '░');
}

/**
 * Cached / total header lines plus the hit bar.
 *
 * `cachedPromptTokens` absent means the provider reported no cache activity at
 * all (old logs predate the field); 0 is a real cold-prefix report, so the two
 * cases render differently. Hit % is omitted when promptTokens is 0 — same
 * divide-by-zero guard the summary embed applies.
 */
function renderCacheHeader(llmResponse: DiagnosticPayload['llmResponse']): string[] {
  const { promptTokens, cachedPromptTokens, cacheDiscount } = llmResponse;
  const lines = [`**Prompt tokens:** ${promptTokens.toLocaleString()}`];

  if (cachedPromptTokens === undefined) {
    lines.push('**Cached:** _no cache reporting from the provider on this request_');
  } else {
    // Clamped BOTH ways: cachedPromptTokens passes through from the raw
    // provider response unvalidated, so cached > prompt must not overflow the
    // fixed 15-cell bar, and a negative count must not reach String.repeat
    // (which throws on negative counts — this view must never throw).
    const hitPct =
      promptTokens > 0
        ? Math.min(100, Math.max(0, (cachedPromptTokens / promptTokens) * 100))
        : null;
    const pctLabel = hitPct !== null ? ` (${Math.round(hitPct)}%)` : '';
    lines.push(`**Cached:** ${cachedPromptTokens.toLocaleString()}${pctLabel}`);
    if (hitPct !== null) {
      lines.push('```', `Hit ${bar(hitPct)} ${hitPct.toFixed(0).padStart(3)}%`, '```');
    }
  }

  if (cacheDiscount !== undefined) {
    lines.push(`**Cache discount:** ${cacheDiscount.toFixed(4)} _(negative = billing credit)_`);
  }

  return lines;
}

/** One prefix-map row: id, tier, chars, offset. */
function formatSectionRow(section: DiagnosticPromptSection): string {
  // Escape BEFORE truncation: once no ``` run exists, cutting a suffix cannot
  // create one, and truncating the escaped form keeps the padded column width
  // exact even if escaping lengthened the id.
  let id = escapeFenceBreaks(section.id);
  if (id.length > SECTION_ID_MAX) {
    id = `${id.slice(0, SECTION_ID_MAX - 1)}…`;
  }
  return `${id.padEnd(SECTION_ID_MAX)} ${section.tier.padEnd(2)} ${section.chars.toLocaleString().padStart(7)} ${section.offset.toLocaleString().padStart(7)}`;
}

/**
 * The fenced prefix map, ordered by offset so the rows read in the order the
 * sections appear in the system message. Sorts a copy — the payload is the
 * caller's stored log and must not be mutated.
 */
function renderSectionTable(sections: readonly DiagnosticPromptSection[]): string[] {
  const ordered = [...sections].sort((a, b) => a.offset - b.offset);
  const lines = [
    '```',
    `${'Section'.padEnd(SECTION_ID_MAX)} ${'Tr'.padEnd(2)} ${'Chars'.padStart(7)} ${'Offset'.padStart(7)}`,
  ];
  for (const section of ordered) {
    lines.push(formatSectionRow(section));
  }
  lines.push('```');
  return lines;
}

/** Prefix-map block, including the two absence cases. */
function renderSectionBlock(sections: DiagnosticPromptSection[] | undefined): string[] {
  if (sections === undefined) {
    return [
      PREFIX_MAP_HEADING,
      '_This log predates system-prompt section tracking — no prefix map available._',
    ];
  }
  if (sections.length === 0) {
    return [PREFIX_MAP_HEADING, '_No sections recorded for this request._'];
  }
  const countLabel = `${sections.length} section${sections.length === 1 ? '' : 's'}`;
  return [`${PREFIX_MAP_HEADING} (${countLabel})`, ...renderSectionTable(sections)];
}

/** Trim table rows from the tail until the description fits the embed cap,
 * keeping the closing fence and appending a notice. */
function trimToEmbedDescription(content: string): string {
  if (content.length <= DESCRIPTION_LIMIT) {
    return content;
  }
  const trimNotice = '_…sections trimmed to fit — full map in the Full JSON view._';
  // Invariant: `tail` holds the closing fence, and the loop only ever removes
  // whole lines from the END of `head` — so the header lines and the opening
  // fence survive any realistic trim (the fenced table dwarfs everything
  // above it long before the header itself would be at risk).
  const fenceEnd = content.lastIndexOf('\n```');
  const tail = fenceEnd > 0 ? content.slice(fenceEnd) : '';
  let head = fenceEnd > 0 ? content.slice(0, fenceEnd) : content;
  while (
    head.length + tail.length + trimNotice.length + 1 > DESCRIPTION_LIMIT &&
    head.includes('\n')
  ) {
    head = head.slice(0, head.lastIndexOf('\n'));
  }
  return `${head}${tail}\n${trimNotice}`;
}

/**
 * Prefix-cache telemetry as an informational embed.
 *
 * The view always opens: every block degrades to an explanatory line rather
 * than throwing, so a log recorded before cache reporting or section tracking
 * still renders. Cache counts are aggregate numeric metadata and stay visible
 * to every viewer; the per-section prefix map is a structural fingerprint of
 * the character's system prompt (which sections exist and their sizes), so it
 * is owner-gated like the other character-internal surfaces.
 */
export function buildCacheView(
  payload: DiagnosticPayload,
  _requestId: string,
  ctx: ViewContext
): DebugViewResult {
  const { llmResponse, assembledPrompt } = payload;

  const sectionBlock = ctx.canViewCharacter
    ? renderSectionBlock(assembledPrompt.systemPromptSections)
    : [
        PREFIX_MAP_HEADING,
        '🔒 _Hidden — this character is owned by another user. Cache totals above remain visible._',
      ];

  const lines = [...renderCacheHeader(llmResponse), '', ...sectionBlock];

  // Informational surface: BLURPLE always (design system — color encodes
  // surface kind, never state).
  const embed = new EmbedBuilder()
    .setTitle('♻️ Cache')
    .setColor(DISCORD_COLORS.BLURPLE)
    .setDescription(trimToEmbedDescription(lines.join('\n')));

  return { embeds: [embed], flags: MessageFlags.Ephemeral };
}
