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
