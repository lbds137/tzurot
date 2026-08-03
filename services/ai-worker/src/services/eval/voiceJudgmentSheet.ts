/**
 * Owner blind-review sheet + gate math for the voice-consistency harness.
 *
 * The LLM judge screens every pair; the owner blind-reviews only the flagged
 * regressions plus a calibration sample (which quietly includes identical-arm
 * control pairs), and owner verdicts OVERRIDE the judge on reviewed pairs.
 * Blinding is seeded (deterministic re-runs); the unblinding map lives in a
 * separate gitignored file and never enters the sheet.
 *
 * Pure module — the eval runners own all I/O and model calls.
 */

import type { ResolvedVerdict } from './voiceJudgePrompt.js';

/** Deterministic PRNG (mulberry32) — seeded blinding, reproducible sheets. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which comparison a pair belongs to. Canonical orientation puts the TESTED
 * arm on the right, always: AB → left=A right=B · CA → left=A right=C ·
 * BB2 → left=B right=B2 (control; neither side is "tested"). */
export type PairKind = 'AB' | 'BB2' | 'CA';

export interface VoicePair {
  /** `${probeId}:${kind}` — stable identity across stages. */
  pairId: string;
  probeId: string;
  personalitySlug: string;
  depth: number;
  kind: PairKind;
  leftText: string;
  rightText: string;
  /** Swap-resolved judge verdict (canonical orientation). */
  verdict: ResolvedVerdict;
}

export interface OwnerMark {
  pairId: string;
  /** 'same' | which BLINDED response read better — mapped to canonical sides via the blinding map. */
  verdict: 'same' | 'left' | 'right';
  hardBreak?: { side: 'left' | 'right'; note: string };
}

/** Per-pair blinding: whether the canonical left renders as "Response 1". */
export interface BlindingEntry {
  pairId: string;
  leftIsResponse1: boolean;
}

/** Select which pairs the owner reviews: every consistent right-side loss and
 * every violation-flagged pair, plus `sampleSize` random others (controls
 * included) as the calibration sample. Returns pairIds, seeded-shuffled so the
 * sheet doesn't group flagged pairs together (that would unblind by position). */
export function selectOwnerReviewPairs(
  pairs: VoicePair[],
  sampleSize: number,
  seed: number
): string[] {
  const random = mulberry32(seed);
  const flagged = new Set<string>();
  for (const pair of pairs) {
    // "right" is the arm under test in canonical orientation (B in AB, A in CA):
    // a consistent LEFT win means the tested arm lost.
    const testedArmLost = pair.kind !== 'BB2' && pair.verdict.winner === 'left';
    if (testedArmLost || pair.verdict.violations.length > 0) {
      flagged.add(pair.pairId);
    }
  }
  const rest = pairs.filter(pair => !flagged.has(pair.pairId));
  const shuffled = rest
    .map(pair => ({ pair, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(entry => entry.pair.pairId);
  const selected = [...flagged, ...shuffled.slice(0, Math.max(0, sampleSize))];
  return selected
    .map(pairId => ({ pairId, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(entry => entry.pairId);
}

/** Seeded per-pair blinding assignment. */
export function buildBlinding(pairIds: string[], seed: number): BlindingEntry[] {
  const random = mulberry32(seed);
  return pairIds.map(pairId => ({ pairId, leftIsResponse1: random() < 0.5 }));
}

const SHEET_HEADER = `# Voice-consistency — owner blind review

For each pair below: read both responses against the persona you know, then
mark EXACTLY ONE of the three verdict boxes with [x]. If a response contains a
hard break (identity slip, speaking for someone else, leaked markup, a
formatting-rule breach), also mark the HARD BREAK box and note which response
and what you saw. Arm identities are withheld by design — judge the text.
`;

export function buildOwnerSheet(
  pairs: VoicePair[],
  reviewIds: string[],
  blinding: BlindingEntry[],
  probeContext: Map<string, { personalitySlug: string; triggerText: string }>
): string {
  const blindingById = new Map(blinding.map(entry => [entry.pairId, entry]));
  const byId = new Map(pairs.map(pair => [pair.pairId, pair]));
  const sections: string[] = [SHEET_HEADER];
  for (const pairId of reviewIds) {
    const pair = byId.get(pairId);
    const blind = blindingById.get(pairId);
    if (pair === undefined || blind === undefined) {
      continue;
    }
    const context = probeContext.get(pair.probeId);
    const response1 = blind.leftIsResponse1 ? pair.leftText : pair.rightText;
    const response2 = blind.leftIsResponse1 ? pair.rightText : pair.leftText;
    sections.push(`## Pair \`${pairId}\`

Persona: **${context?.personalitySlug ?? pair.personalitySlug}** · replying to:

> ${(context?.triggerText ?? '').split('\n').join('\n> ')}

**Response 1**

${response1}

**Response 2**

${response2}

- [ ] same / within normal variation
- [ ] response 1 reads more in-voice
- [ ] response 2 reads more in-voice
- [ ] HARD BREAK in response __: describe what you saw
`);
  }
  return sections.join('\n---\n\n');
}

const PAIR_HEADING_RE = /^## Pair `([^`]+)`/;
const CHECKED_RE = /^- \[x\] (.+)$/i;

/** Map one checked verdict line to a canonical-side verdict. */
function mapVerdictLine(pairId: string, line: string, blind: BlindingEntry): OwnerMark['verdict'] {
  if (/^same/i.test(line)) {
    return 'same';
  }
  if (/^response 1/i.test(line)) {
    return blind.leftIsResponse1 ? 'left' : 'right';
  }
  if (/^response 2/i.test(line)) {
    return blind.leftIsResponse1 ? 'right' : 'left';
  }
  throw new Error(`Pair ${pairId}: unrecognized verdict line "${line}"`);
}

/** Map a checked hard-break line's blinded response number to a canonical side. */
function mapHardBreakLine(
  pairId: string,
  line: string,
  blind: BlindingEntry
): NonNullable<OwnerMark['hardBreak']> {
  const match = /response\s*([12])/i.exec(line);
  if (match === null) {
    throw new Error(`Pair ${pairId}: HARD BREAK checked but no response number filled in`);
  }
  const blindSide = match[1] === '1';
  return { side: blindSide === blind.leftIsResponse1 ? 'left' : 'right', note: line };
}

/** Resolve one pair's checked lines into a mark (null = nothing checked). */
function resolvePairMark(
  pairId: string,
  checked: string[],
  blindingById: Map<string, BlindingEntry>
): OwnerMark | null {
  const blind = blindingById.get(pairId);
  if (blind === undefined) {
    throw new Error(`Sheet pair ${pairId} has no blinding entry`);
  }
  const verdictLines = checked.filter(line => !/^hard break/i.test(line));
  const hardBreakLines = checked.filter(line => /^hard break/i.test(line));
  if (verdictLines.length > 1) {
    throw new Error(`Pair ${pairId}: multiple verdict boxes checked`);
  }
  if (verdictLines.length === 0) {
    // A hard break with no verdict box is a plausible owner slip — dropping it
    // silently would undercount hard breaks in the report; ambiguity is loud.
    if (hardBreakLines.length > 0) {
      throw new Error(
        `Pair ${pairId}: HARD BREAK checked but no verdict box — check same/response 1/response 2 too`
      );
    }
    return null;
  }
  return {
    pairId,
    verdict: mapVerdictLine(pairId, verdictLines[0], blind),
    hardBreak:
      hardBreakLines.length > 0 ? mapHardBreakLine(pairId, hardBreakLines[0], blind) : undefined,
  };
}

/** Parse the filled sheet back into owner marks (blinded labels → canonical
 * sides via the blinding map). Hard-errors on ambiguity — same contract as the
 * qrels reconciler: a silently mis-parsed mark is worse than a loud one. */
export function parseOwnerSheet(sheet: string, blinding: BlindingEntry[]): OwnerMark[] {
  const blindingById = new Map(blinding.map(entry => [entry.pairId, entry]));
  const marks: OwnerMark[] = [];
  let current: { pairId: string; checked: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) {
      const mark = resolvePairMark(current.pairId, current.checked, blindingById);
      if (mark !== null) {
        marks.push(mark);
      }
      current = null;
    }
  };

  for (const line of sheet.split('\n')) {
    const heading = PAIR_HEADING_RE.exec(line);
    if (heading !== null) {
      flush();
      current = { pairId: heading[1], checked: [] };
      continue;
    }
    const checked = CHECKED_RE.exec(line.trim());
    if (checked !== null && current !== null) {
      current.checked.push(checked[1].trim());
    }
  }
  flush();
  return marks;
}

export interface GateThresholds {
  /** Floor for the net-preference FAIL threshold (default 0.15). */
  minNetFail: number;
  /** Margin added to the control net (default 0.10). */
  controlMargin: number;
  /** Per-persona collapse threshold (default 0.40). */
  personaCollapse: number;
  /** Control consistent-preference rate above which the run is under-powered. */
  underpoweredControlRate: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minNetFail: 0.15,
  controlMargin: 0.1,
  personaCollapse: 0.4,
  underpoweredControlRate: 0.35,
};

export interface GateInputs {
  /** The comparison pairs under test (AB on the primary run, CA on the remedy run). */
  testPairs: VoicePair[];
  /** Identical-arm control pairs (BB2). */
  controlPairs: VoicePair[];
  ownerMarks: OwnerMark[];
  /** Hard breaks that REPRODUCED on the regeneration pass (operational input). */
  reproducedHardBreaks: number;
  thresholds?: GateThresholds;
}

export interface GateResult {
  verdict: 'NOT_FAILED_PENDING_OWNER' | 'FAIL' | 'UNDERPOWERED';
  reasons: string[];
  net: number;
  netFailThreshold: number;
  controlNet: number;
  controlConsistentRate: number;
  perPersonaNet: Record<string, number>;
  testedArmLosses: number;
  testedArmWins: number;
  ties: number;
  ownerOverrides: number;
  ownerHardBreaks: number;
}

type EffectiveWinner = (pair: VoicePair) => 'left' | 'right' | 'tie';

/** Control calibration — the judge's (and owner's) noise floor on identical-arm pairs. */
function tallyControls(
  controlPairs: VoicePair[],
  effectiveWinner: EffectiveWinner
): { controlConsistentRate: number; controlNet: number } {
  let left = 0;
  let right = 0;
  for (const pair of controlPairs) {
    const winner = effectiveWinner(pair);
    if (winner === 'left') {
      left += 1;
    } else if (winner === 'right') {
      right += 1;
    }
  }
  const count = controlPairs.length;
  return {
    controlConsistentRate: count > 0 ? (left + right) / count : 0,
    controlNet: count > 0 ? Math.abs(left - right) / count : 0,
  };
}

interface TestTally {
  losses: number;
  wins: number;
  ties: number;
  net: number;
  perPersonaNet: Record<string, number>;
}

/** Tally the comparison pairs. Canonical orientation puts the TESTED arm on
 * the right (AB: right=B; CA: right=C), so winner==='left' always reads
 * "the tested arm lost". */
function tallyTestPairs(testPairs: VoicePair[], effectiveWinner: EffectiveWinner): TestTally {
  let losses = 0;
  let wins = 0;
  let ties = 0;
  const perPersona = new Map<string, { losses: number; wins: number; total: number }>();
  for (const pair of testPairs) {
    const winner = effectiveWinner(pair);
    const bucket = perPersona.get(pair.personalitySlug) ?? { losses: 0, wins: 0, total: 0 };
    bucket.total += 1;
    if (winner === 'left') {
      losses += 1;
      bucket.losses += 1;
    } else if (winner === 'right') {
      wins += 1;
      bucket.wins += 1;
    } else {
      ties += 1;
    }
    perPersona.set(pair.personalitySlug, bucket);
  }
  const perPersonaNet: Record<string, number> = {};
  for (const [slug, bucket] of perPersona) {
    perPersonaNet[slug] = bucket.total > 0 ? (bucket.losses - bucket.wins) / bucket.total : 0;
  }
  return {
    losses,
    wins,
    ties,
    net: testPairs.length > 0 ? (losses - wins) / testPairs.length : 0,
    perPersonaNet,
  };
}

/** Fold the tallies into a verdict + reasons (FAIL wins over UNDERPOWERED). */
function deriveVerdict(
  tally: TestTally,
  control: { controlConsistentRate: number; controlNet: number },
  reproducedHardBreaks: number,
  thresholds: GateThresholds,
  netFailThreshold: number
): { verdict: GateResult['verdict']; reasons: string[] } {
  const reasons: string[] = [];
  let verdict: GateResult['verdict'] = 'NOT_FAILED_PENDING_OWNER';

  if (control.controlConsistentRate > thresholds.underpoweredControlRate) {
    verdict = 'UNDERPOWERED';
    reasons.push(
      `Control consistent-preference rate ${control.controlConsistentRate.toFixed(2)} exceeds ` +
        `${thresholds.underpoweredControlRate} — add probes before trusting any verdict.`
    );
  }
  if (reproducedHardBreaks > 0) {
    verdict = 'FAIL';
    reasons.push(`${reproducedHardBreaks} hard break(s) reproduced on regeneration.`);
  }
  if (tally.net > netFailThreshold) {
    verdict = 'FAIL';
    reasons.push(
      `Net tested-arm losses ${tally.net.toFixed(2)} exceed threshold ` +
        `${netFailThreshold.toFixed(2)} (control net ${control.controlNet.toFixed(2)}).`
    );
  }
  for (const [slug, personaNet] of Object.entries(tally.perPersonaNet)) {
    if (personaNet > thresholds.personaCollapse) {
      verdict = 'FAIL';
      reasons.push(
        `Persona ${slug} collapsed: net ${personaNet.toFixed(2)} > ${thresholds.personaCollapse}.`
      );
    }
  }
  return { verdict, reasons };
}

/** Apply owner overrides (owner wins on reviewed pairs), then compute the gate. */
export function computeGate(inputs: GateInputs): GateResult {
  const thresholds = inputs.thresholds ?? DEFAULT_THRESHOLDS;
  const marksById = new Map(inputs.ownerMarks.map(mark => [mark.pairId, mark]));

  const effectiveWinner: EffectiveWinner = pair => {
    const mark = marksById.get(pair.pairId);
    if (mark === undefined) {
      return pair.verdict.winner;
    }
    return mark.verdict === 'same' ? 'tie' : mark.verdict;
  };

  // Owner overrides apply to controls too — an owner "preferring" a side of an
  // identical-arm pair is exactly the noise being measured.
  const control = tallyControls(inputs.controlPairs, effectiveWinner);
  const tally = tallyTestPairs(inputs.testPairs, effectiveWinner);
  const netFailThreshold = Math.max(
    control.controlNet + thresholds.controlMargin,
    thresholds.minNetFail
  );
  const { verdict, reasons } = deriveVerdict(
    tally,
    control,
    inputs.reproducedHardBreaks,
    thresholds,
    netFailThreshold
  );

  // Report only marks that touched pairs in THIS gate's set — a mixed-round
  // sheet (AB + CA) must not overcount "owner reviewed" for one comparison.
  const gatedPairIds = new Set(
    [...inputs.testPairs, ...inputs.controlPairs].map(pair => pair.pairId)
  );
  const gatedMarks = inputs.ownerMarks.filter(mark => gatedPairIds.has(mark.pairId));

  return {
    verdict,
    reasons,
    net: tally.net,
    netFailThreshold,
    controlNet: control.controlNet,
    controlConsistentRate: control.controlConsistentRate,
    perPersonaNet: tally.perPersonaNet,
    testedArmLosses: tally.losses,
    testedArmWins: tally.wins,
    ties: tally.ties,
    ownerOverrides: gatedMarks.length,
    ownerHardBreaks: gatedMarks.filter(mark => mark.hardBreak !== undefined).length,
  };
}
