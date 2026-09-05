import { describe, it, expect } from 'vitest';
import type {
  AnswerRecord,
  SummaryRecord,
  SummaryJudgeRecord,
  FactsRecord,
  VoiceRecord,
  ReportBuildInput,
  ReportJson,
} from './render-pilot-report-types.js';

// Pure type declarations — this test exists to satisfy structure.test.ts's
// colocated-test requirement and to pin the shapes via `satisfies`, so a
// field rename here breaks the build at the fixture site rather than
// silently drifting from what render-pilot-metrics.ts actually produces.
describe('render-pilot report types', () => {
  it('accepts a well-formed AnswerRecord', () => {
    const record = {
      arm: 'V',
      basis: 'assistant',
      judged: true,
      correct: true,
      faithful: true,
      unsupportedClaims: [],
      tailTokens: 10,
      truncated: false,
      reply: 'x',
    } satisfies AnswerRecord;
    expect(record.judged).toBe(true);
  });

  it('accepts a well-formed SummaryRecord and SummaryJudgeRecord', () => {
    const summary = {
      tokens: 10,
      state: 'within_soft',
      hasFirstPerson: false,
      parseFailed: false,
      summary: 'x',
    } satisfies SummaryRecord;
    const judgement = {
      judged: true,
      faithful: true,
      danglingReference: false,
      missingCommitments: [],
      hasReferenced: false,
    } satisfies SummaryJudgeRecord;
    expect(summary.state).toBe('within_soft');
    expect(judgement.judged).toBe(true);
  });

  it('accepts a well-formed FactsRecord and VoiceRecord', () => {
    const facts = { hadFacts: true, missingCommitments: [] } satisfies FactsRecord;
    const voice = {
      arm: 'V',
      chars: 1,
      words: 1,
      exclamationsPer100Words: 0,
      emojiCount: 0,
      thirdPersonSelfReference: false,
      markerHits: 0,
      truncated: false,
      reply: 'x',
    } satisfies VoiceRecord;
    expect(facts.hadFacts).toBe(true);
    expect(voice.arm).toBe('V');
  });

  it('assembles a well-formed ReportBuildInput', () => {
    const input = {
      characterName: 'Nova',
      answers: [],
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [],
      usage: [],
      droppedMalformedQuestions: 0,
    } satisfies ReportBuildInput;
    expect(input.characterName).toBe('Nova');
  });

  it('assembles a well-formed ReportJson', () => {
    const armStats = {
      n: 0,
      unjudged: 0,
      correctnessRate: 0,
      correctnessByBasis: { assistant: 0, user: 0 },
      unfaithfulRate: 0,
      unsupportedClaimsMean: 0,
      tokensInTail: { mean: 0, p95: 0 },
      truncatedRate: 0,
    };
    const voiceStats = {
      n: 0,
      charsMean: 0,
      wordsMean: 0,
      exclamationsPer100WordsMean: 0,
      emojiCountMean: 0,
      selfReferenceRate: 0,
      markerHitsMean: 0,
      truncatedRate: 0,
    };
    const report = {
      character: 'Nova',
      arms: { V: armStats, F: armStats, S: armStats },
      summaryArm: {
        n: 0,
        unjudged: 0,
        faithfulRate: 0,
        danglingReferenceRateOverReferenced: 0,
        danglingReferenceRateOverAll: 0,
        missingCommitmentRate: 0,
        stateDistribution: { within_soft: 0, regenerated: 0, overflow: 0 },
        firstPersonRate: 0,
        tokens: { mean: 0, p95: 0 },
        parseFailedCount: 0,
      },
      factsArm: { n: 0, rowsWithoutFactsShare: 0, missingCommitmentRate: 0 },
      voice: { V: voiceStats, F: voiceStats, S: voiceStats },
      usage: [],
      droppedMalformedQuestions: 0,
    } satisfies ReportJson;
    expect(report.character).toBe('Nova');
  });
});
