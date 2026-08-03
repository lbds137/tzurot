/**
 * Voice-consistency JUDGE runner (stage 2 of 3) — responses.json →
 * position-swapped LLM-judge calls → judgments.json + the blinded owner sheet.
 *
 * MEASUREMENT, not CI: real judge-model spend, run manually via
 * `pnpm eval:voice-judge`. Needs only responses.json (stage 1 bundles the
 * judge context — persona card, register-anchor turns, trigger) plus the
 * judge key; no DB.
 *
 * The judge model must be FAMILY-DISJOINT from every generation model
 * (self-preference bias); the default assumes GLM/Qwen-family personas and a
 * Claude judge via OpenRouter — override with VOICE_EVAL_JUDGE_MODEL after
 * the persona-model census. Temperature 0. Each pair is judged twice with
 * positions swapped; a preference counts only when both orders agree.
 *
 * Also judges a sample of arm-A responses against the REAL logged reply
 * (the harness validity anchor — expect tie-dominated; reported, not gated).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HumanMessage } from '@langchain/core/messages';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createChatModel } from '../ModelFactory.js';
import {
  buildJudgePrompt,
  parseJudgeVerdict,
  resolveSwappedVerdicts,
  type JudgeVerdict,
} from './voiceJudgePrompt.js';
import {
  buildBlinding,
  buildOwnerSheet,
  selectOwnerReviewPairs,
  type PairKind,
  type VoicePair,
} from './voiceJudgmentSheet.js';

const WORK_DIR = 'reports/voice-consistency';
const RESPONSES_PATH = join(WORK_DIR, 'responses.json');
const JUDGE_MODEL = process.env.VOICE_EVAL_JUDGE_MODEL ?? 'anthropic/claude-sonnet-4.5';
const SEED = Number(process.env.VOICE_EVAL_SEED ?? 190);
const OWNER_SAMPLE_SIZE = Number(process.env.VOICE_EVAL_OWNER_SAMPLE ?? 8);
/** Validity-anchor sample: judge arm A vs the real logged reply on this many probes. */
const ANCHOR_SAMPLE = Number(process.env.VOICE_EVAL_ANCHOR_SAMPLE ?? 6);

interface ResponsesFile {
  meta: { arms: string[] };
  judgeContext: Record<
    string,
    {
      personalitySlug: string;
      depth: number;
      personaCard: string;
      recentTurns: { speaker: string; text: string }[];
      triggerText: string;
      referenceReply: string;
    }
  >;
  responses: {
    probeId: string;
    arm: string;
    personalitySlug: string;
    depth: number;
    text: string;
  }[];
}

/** (kind, leftArm, rightArm) — canonical orientation puts the tested arm right. */
const PAIRINGS: { kind: PairKind; left: string; right: string }[] = [
  { kind: 'AB', left: 'A', right: 'B' },
  { kind: 'BB2', left: 'B', right: 'B2' },
  { kind: 'CA', left: 'A', right: 'C' },
];

const ready = existsSync(RESPONSES_PATH) && process.env.OPENROUTER_API_KEY !== undefined;

describe.skipIf(!ready)('voice-consistency judge (REAL judge-model spend)', () => {
  let file: ResponsesFile;
  const pairs: VoicePair[] = [];
  const anchorResults: { probeId: string; winner: string }[] = [];

  beforeAll(() => {
    file = JSON.parse(readFileSync(RESPONSES_PATH, 'utf8')) as ResponsesFile;
  });

  afterAll(() => {
    if (pairs.length === 0) {
      return;
    }
    mkdirSync(WORK_DIR, { recursive: true });
    writeFileSync(
      join(WORK_DIR, 'judgments.json'),
      `${JSON.stringify({ meta: { judgeModel: JUDGE_MODEL, seed: SEED }, pairs, anchorResults }, null, 2)}\n`
    );

    const reviewIds = selectOwnerReviewPairs(pairs, OWNER_SAMPLE_SIZE, SEED);
    const blinding = buildBlinding(reviewIds, SEED + 1);
    const probeContext = new Map(
      Object.entries(file.judgeContext).map(([probeId, context]) => [
        probeId,
        { personalitySlug: context.personalitySlug, triggerText: context.triggerText },
      ])
    );
    writeFileSync(
      join(WORK_DIR, 'judgment-sheet.md'),
      buildOwnerSheet(pairs, reviewIds, blinding, probeContext)
    );
    // The unblinding map: gitignored, NEVER enters the sheet or the judge prompt.
    writeFileSync(join(WORK_DIR, 'blinding.json'), `${JSON.stringify({ blinding }, null, 2)}\n`);
    console.log(
      `\n=== voice judge: ${pairs.length} pairs judged → judgment-sheet.md has ` +
        `${reviewIds.length} pairs for the owner's blind review ===`
    );
  });

  async function judgeCall(prompt: string): Promise<JudgeVerdict> {
    const { model } = createChatModel({
      provider: AIProvider.OpenRouter,
      modelName: JUDGE_MODEL,
      temperature: 0,
      maxTokens: 1024,
      appTitleSuffix: 'VoiceEvalJudge',
    });
    const result = await model.invoke([new HumanMessage(prompt)]);
    const text =
      typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    return parseJudgeVerdict(text);
  }

  /** One flaky completion must not abort an hours-long, real-money run:
   * retry once (short backoff for transient 429s), then let the caller skip. */
  async function judgeCallResilient(prompt: string): Promise<JudgeVerdict> {
    try {
      return await judgeCall(prompt);
    } catch (error) {
      console.warn(`Judge call failed, retrying once after backoff: ${String(error)}`);
      // eslint-disable-next-line no-restricted-syntax -- eval runner (never CI, real network): a real 3s backoff before retrying a paid judge call; fake timers would hang the live request
      await new Promise(resolveDelay => setTimeout(resolveDelay, 3_000));
      return judgeCall(prompt);
    }
  }

  /** null = both attempts of one order failed; the pair is skipped and counted. */
  async function judgeSwappedPair(
    context: ResponsesFile['judgeContext'][string],
    leftText: string,
    rightText: string
  ): Promise<ReturnType<typeof resolveSwappedVerdicts> | null> {
    const base = {
      personaCard: context.personaCard,
      recentTurns: context.recentTurns,
      triggerText: context.triggerText,
    };
    try {
      const forward = await judgeCallResilient(
        buildJudgePrompt({ ...base, response1: leftText, response2: rightText })
      );
      const swapped = await judgeCallResilient(
        buildJudgePrompt({ ...base, response1: rightText, response2: leftText })
      );
      return resolveSwappedVerdicts(forward, swapped);
    } catch (error) {
      console.warn(`Pair skipped after retry: ${String(error)}`);
      return null;
    }
  }

  it(
    'judges every pair twice (positions swapped) and builds the blinded owner sheet',
    { timeout: 3_600_000 },
    async () => {
      const byProbeArm = new Map<string, string>();
      for (const response of file.responses) {
        byProbeArm.set(`${response.probeId}:${response.arm}`, response.text);
      }

      let skippedPairs = 0;
      for (const [probeId, context] of Object.entries(file.judgeContext)) {
        for (const pairing of PAIRINGS) {
          const leftText = byProbeArm.get(`${probeId}:${pairing.left}`);
          const rightText = byProbeArm.get(`${probeId}:${pairing.right}`);
          if (leftText === undefined || rightText === undefined) {
            continue; // that arm wasn't generated in this run
          }
          const verdict = await judgeSwappedPair(context, leftText, rightText);
          if (verdict === null) {
            skippedPairs += 1;
            continue;
          }
          pairs.push({
            pairId: `${probeId}:${pairing.kind}`,
            probeId,
            personalitySlug: context.personalitySlug,
            depth: context.depth,
            kind: pairing.kind,
            leftText,
            rightText,
            verdict,
          });
          console.log(
            `${context.personalitySlug} d${context.depth} ${pairing.kind}: ` +
              `${verdict.winner}${verdict.violations.length > 0 ? ` (${verdict.violations.length} violation flags)` : ''}`
          );
        }
      }
      if (skippedPairs > 0) {
        // No silent caps: a skipped pair is a coverage hole the verdict stage
        // must know about, not a quiet shrink of n.
        console.warn(`⚠ ${skippedPairs} pair(s) skipped after judge retries — n is smaller.`);
      }
      expect(pairs.length).toBeGreaterThan(0);

      // Validity anchor: arm A vs the REAL logged reply on a sample — if A
      // "loses" badly to its own production twin, fix the harness first.
      const anchorProbes = Object.entries(file.judgeContext).slice(0, ANCHOR_SAMPLE);
      for (const [probeId, context] of anchorProbes) {
        const armAText = byProbeArm.get(`${probeId}:A`);
        if (armAText === undefined || context.referenceReply.length === 0) {
          continue;
        }
        const verdict = await judgeSwappedPair(context, armAText, context.referenceReply);
        if (verdict !== null) {
          anchorResults.push({ probeId, winner: verdict.winner });
        }
      }
      if (anchorResults.length > 0) {
        const aLosses = anchorResults.filter(result => result.winner === 'right').length;
        console.log(
          `Validity anchor (A vs real reply, n=${anchorResults.length}): ` +
            `${aLosses} A-losses — expect tie-dominated; investigate the harness if not.`
        );
      }
    }
  );
});
