/**
 * Recent-days digest: the operator dry run for one pair.
 *
 * Runs the exact same window-load + prompt-build + model-round path the
 * sweep's `processOnePair` runs, for a single (persona, personality) pair
 * chosen by the caller — but performs NO store write of any kind (no digest
 * row, no usage row). The model call is still billed; only the bookkeeping
 * writes are skipped.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import type { DigestCandidatePair } from '@tzurot/common-types/services/recentDaysDigestSelection';
import { countTextTokens } from '@tzurot/common-types/utils/tokenCounter';
import type { SystemModelInvoker } from '../systemModel/systemModelCall.js';
import { buildDigestPrompt } from './recentDaysDigestPrompt.js';
import {
  buildPairGenerationContext,
  loadWindowRows,
  runGeneration,
  type DigestGenerationOutcome,
} from './recentDaysDigestGeneration.js';

export interface DryRunReport {
  pair: { personaName: string; personalityName: string; ownerTimezone: string };
  window: {
    rowCount: number;
    windowStart: Date;
    sourceWatermark: Date;
    truncated: boolean;
    inputTokens: number;
  };
  outcome: DigestGenerationOutcome;
}

/** One pair, start to finish, mirroring the sweep's `processOnePair` exactly
 *  — the whole value of the dry run is that it runs the same path — except no
 *  digest or usage row is ever written. */
export async function dryRunDigestForPair(
  prisma: PrismaClient,
  args: { pair: DigestCandidatePair; invoke: SystemModelInvoker; now: Date }
): Promise<DryRunReport> {
  const { pair, invoke, now } = args;
  const rows = await loadWindowRows(prisma, pair, now);
  const { windowInput, promptInput, assistantContents } = buildPairGenerationContext(pair, rows);

  const outcome = await runGeneration({
    prisma,
    pair,
    invoke,
    promptInput,
    assistantContents,
    writeUsage: false,
  });

  return {
    pair: {
      personaName: promptInput.personaLabel,
      personalityName: promptInput.characterLabel,
      ownerTimezone: pair.ownerTimezone,
    },
    window: {
      rowCount: windowInput.sourceRowCount,
      windowStart: windowInput.windowStart,
      sourceWatermark: windowInput.sourceWatermark,
      truncated: windowInput.truncated,
      inputTokens: countTextTokens(buildDigestPrompt(promptInput)),
    },
    outcome,
  };
}

/** Render a pass's raw output, verdict, and length state as report lines. */
function renderPass(label: string, pass: DryRunReport['outcome']['firstPass']): string[] {
  const lines = [
    `--- ${label} (raw, ${pass.tokensIn} tokens in, ${pass.tokensOut} tokens out, ${pass.latencyMs}ms) ---`,
    pass.raw,
  ];
  if (pass.validation === null) {
    lines.push('verdict: (did not parse)');
  } else if (pass.validation.ok) {
    lines.push('verdict: ok');
  } else {
    lines.push(`verdict: ${pass.validation.cls}: ${pass.validation.detail}`);
  }
  lines.push(pass.lengthState === null ? 'length: (n/a)' : `length: ${pass.lengthState}`);
  return lines;
}

/** Render the final outcome line — success also prints the model + prompt
 *  version that were billed. */
function renderFinalLine(outcome: DigestGenerationOutcome): string {
  if (outcome.kind === 'success') {
    return [
      'final: success',
      `model: ${outcome.model}`,
      `promptVersion: ${outcome.promptVersion}`,
    ].join('\n');
  }
  if (outcome.kind === 'failed') {
    return `final: failed ${outcome.cls}: ${outcome.detail}`;
  }
  return 'final: parse_failure';
}

/** Pure report renderer — no I/O. Prints the header, the pair/window
 *  summary, every pass in order, and the final outcome line. */
export function printDryRunReport(report: DryRunReport): string {
  const { pair, window, outcome } = report;
  const lines: string[] = [
    'DRY RUN — no digest row written, no usage row written; the model call WAS billed',
    `pair: persona="${pair.personaName}" character="${pair.personalityName}" tz=${pair.ownerTimezone}`,
    `window: rows=${window.rowCount} truncated=${window.truncated} estimatedInputTokens=${window.inputTokens} windowStart=${window.windowStart.toISOString()} watermark=${window.sourceWatermark.toISOString()}`,
    '',
    ...renderPass('pass 1', outcome.firstPass),
  ];
  if (outcome.regen !== undefined) {
    lines.push('', ...renderPass('pass 2', outcome.regen));
  }
  lines.push('', renderFinalLine(outcome));
  return lines.join('\n');
}
