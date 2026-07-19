// Extracted from views.ts to stay under the 400-line ESLint limit.

import { EmbedBuilder, MessageFlags } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { DiagnosticPayload, PipelineStep } from '@tzurot/common-types/types/diagnostic';
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
    thinkingContent !== null ? `${thinkingContent.length.toLocaleString()} chars` : '_none_';
  const artifactsLabel = artifactsStripped.length > 0 ? artifactsStripped.join(', ') : '_none_';

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
