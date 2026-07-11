// Extracted from views.ts to stay under the 400-line ESLint limit.

import { MessageFlags } from 'discord.js';
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

/** Fixed-width rows in a code fence — Discord doesn't render markdown
 * pipe-tables inline (same solve as the memory inspector / db-sync stats). */
function renderStepRows(steps: readonly PipelineStep[]): string[] {
  const nameWidth = Math.max(...steps.map(s => s.name.length));
  const rows = ['```'];
  for (const step of steps) {
    const icon = STATUS_ICON[step.status];
    // Reasons can carry model/content-derived text — fence-escape them
    const reason = escapeFenceBreaks(step.reason ?? '—');
    rows.push(`${step.name.padEnd(nameWidth)}  ${icon} ${step.status.padEnd(7)} ${reason}`);
  }
  rows.push('```');
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

function renderContextSection(payload: DiagnosticPayload): string[] {
  const { finalContent, thinkingContent, artifactsStripped } = payload.postProcessing;
  const thinkingLabel =
    thinkingContent !== null ? `${thinkingContent.length.toLocaleString()} chars` : '_none_';
  const artifactsLabel = artifactsStripped.length > 0 ? artifactsStripped.join(', ') : '_none_';
  return [
    '',
    '## Context',
    `- **Final content:** ${finalContent.length.toLocaleString()} chars`,
    `- **Thinking content:** ${thinkingLabel}`,
    `- **Artifacts stripped:** ${artifactsLabel}`,
  ];
}

/** Markdown checklist of post-processing pipeline outcomes. */
export function buildPipelineHealthView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const steps = payload.postProcessing.pipelineSteps;
  const lines: string[] = ['# Pipeline Health', ''];

  if (steps === undefined) {
    lines.push(...renderLegacyTransforms(payload.postProcessing.transformsApplied));
  } else if (steps.length === 0) {
    lines.push('_No pipeline steps recorded._');
  } else {
    lines.push(...renderStepRows(steps));
  }

  lines.push(...renderContextSection(payload));

  return {
    chunkedText: {
      text: lines.join('\n'),
      continuedHeader: '_(pipeline health continued)_\n',
    },
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------------------
// Quick-copy summary
// ---------------------------------------------------------------------------

/** One-line summary like `z-ai/glm-4.7 via DekaLLM · 9.6s · 47 tok · thinking 1063 chars`. */
export function buildQuickCopySummaryView(
  payload: DiagnosticPayload,
  _requestId: string,
  // intentionally unused — uniform VIEW_BUILDERS signature
  _ctx: ViewContext
): DebugViewResult {
  const { llmConfig, llmResponse, timing, postProcessing } = payload;

  const upstreamProvider = llmResponse.reasoningDebug?.upstreamProvider;
  const modelLine =
    upstreamProvider !== undefined ? `${llmConfig.model} via ${upstreamProvider}` : llmConfig.model;

  const durationSec = (timing.totalDurationMs / 1000).toFixed(1);
  const thinkingLen = postProcessing.thinkingContent?.length ?? 0;
  const thinkingPart = thinkingLen > 0 ? ` · thinking ${thinkingLen.toLocaleString()} chars` : '';

  const summary = `\`${modelLine} · ${durationSec}s · ${llmResponse.completionTokens} tok${thinkingPart}\``;

  return {
    content: `**Quick copy:**\n${summary}`,
    flags: MessageFlags.Ephemeral,
  };
}
