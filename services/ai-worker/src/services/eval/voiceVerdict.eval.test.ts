/**
 * Voice-consistency VERDICT runner (stage 3 of 3) — judgments.json + the
 * owner's filled blind sheet → unblind → pre-registered gate → report.md.
 *
 * No model calls, no DB — pure aggregation, run via `pnpm eval:voice-verdict`
 * after the owner fills reports/voice-consistency/judgment-sheet.md.
 *
 * The gate is asymmetric by design: mechanical numbers can force FAIL, but
 * only the owner grants PASS — the report says NOT_FAILED_PENDING_OWNER on
 * the good path, and the owner's sign-off (recorded in the epic roadmap) is
 * the PASS. All numbers print regardless of verdict.
 *
 * VOICE_EVAL_REPRODUCED_BREAKS=<n>: operational input — hard breaks that
 * recurred when their probe was regenerated once (the pre-registered
 * recurrence rule). VOICE_EVAL_GATE_KIND=AB|CA selects which comparison is
 * being gated (AB on the primary run, CA on the remedy run).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeGate,
  DEFAULT_THRESHOLDS,
  parseOwnerSheet,
  type BlindingEntry,
  type PairKind,
  type VoicePair,
} from './voiceJudgmentSheet.js';

const WORK_DIR = 'reports/voice-consistency';
const JUDGMENTS_PATH = join(WORK_DIR, 'judgments.json');
const SHEET_PATH = join(WORK_DIR, 'judgment-sheet.md');
const BLINDING_PATH = join(WORK_DIR, 'blinding.json');
const GATE_KIND = (process.env.VOICE_EVAL_GATE_KIND ?? 'AB') as PairKind;
const REPRODUCED_BREAKS = Number(process.env.VOICE_EVAL_REPRODUCED_BREAKS ?? 0);

const ready = existsSync(JUDGMENTS_PATH) && existsSync(SHEET_PATH) && existsSync(BLINDING_PATH);

describe.skipIf(!ready)('voice-consistency verdict', () => {
  let pairs: VoicePair[];
  let anchorResults: { probeId: string; winner: string }[];
  let blinding: BlindingEntry[];
  let sheet: string;

  beforeAll(() => {
    const judgments = JSON.parse(readFileSync(JUDGMENTS_PATH, 'utf8')) as {
      pairs: VoicePair[];
      anchorResults?: { probeId: string; winner: string }[];
    };
    pairs = judgments.pairs;
    anchorResults = judgments.anchorResults ?? [];
    blinding = (JSON.parse(readFileSync(BLINDING_PATH, 'utf8')) as { blinding: BlindingEntry[] })
      .blinding;
    sheet = readFileSync(SHEET_PATH, 'utf8');
  });

  it('unblinds the owner sheet, applies the pre-registered gate, and writes the report', () => {
    const ownerMarks = parseOwnerSheet(sheet, blinding);
    const testPairs = pairs.filter(pair => pair.kind === GATE_KIND);
    const controlPairs = pairs.filter(pair => pair.kind === 'BB2');
    expect(testPairs.length).toBeGreaterThan(0);

    const result = computeGate({
      testPairs,
      controlPairs,
      ownerMarks,
      reproducedHardBreaks: REPRODUCED_BREAKS,
    });

    const anchorLosses = anchorResults.filter(anchor => anchor.winner === 'right').length;
    const lines = [
      `# Voice-consistency gate — ${GATE_KIND} comparison`,
      '',
      '## Pre-registered thresholds',
      '',
      `- Net FAIL threshold: max(control net + ${DEFAULT_THRESHOLDS.controlMargin}, ${DEFAULT_THRESHOLDS.minNetFail})`,
      `- Per-persona collapse: > ${DEFAULT_THRESHOLDS.personaCollapse}`,
      `- Under-powered when control consistent-preference rate > ${DEFAULT_THRESHOLDS.underpoweredControlRate}`,
      '- Any reproduced hard break → FAIL · PASS requires owner sign-off',
      '',
      '## Result',
      '',
      `- **Verdict: ${result.verdict}**`,
      ...result.reasons.map(reason => `  - ${reason}`),
      `- Test pairs: ${testPairs.length} (${result.testedArmLosses} tested-arm losses / ${result.testedArmWins} wins / ${result.ties} ties)`,
      `- Net: ${result.net.toFixed(3)} vs threshold ${result.netFailThreshold.toFixed(3)}`,
      `- Control pairs: ${controlPairs.length} (consistent-preference rate ${result.controlConsistentRate.toFixed(2)}, net ${result.controlNet.toFixed(2)})`,
      `- Per-persona net: ${Object.entries(result.perPersonaNet)
        .map(([slug, net]) => `${slug}=${net.toFixed(2)}`)
        .join(' · ')}`,
      `- Owner reviewed: ${result.ownerOverrides} pairs (${result.ownerHardBreaks} hard-break marks)`,
      `- Validity anchor (A vs real reply): ${anchorResults.length} judged, ${anchorLosses} A-losses (expect tie-dominated)`,
      '',
      result.verdict === 'FAIL' && GATE_KIND === 'AB'
        ? 'Next: generate arm C (`VOICE_EVAL_ARMS=A,C pnpm eval:voice-replay`), judge, and re-gate with VOICE_EVAL_GATE_KIND=CA — the pre-decided remedy path.'
        : 'Next: record the verdict + numbers in backlog/active-epic.md; owner sign-off on the unblinded report grants PASS.',
    ];
    writeFileSync(join(WORK_DIR, 'report.md'), `${lines.join('\n')}\n`);
    console.log(lines.join('\n'));
  });
});
