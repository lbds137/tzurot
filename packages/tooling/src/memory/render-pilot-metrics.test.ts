import { describe, it, expect } from 'vitest';
import {
  extractJsonBlock,
  parseSummaryResponse,
  parseQuestionsResponse,
  parseAnswerJudgement,
  parseSummaryJudgement,
  parseFactsJudgement,
  decideSummaryOutcome,
  hasFirstPerson,
  countWords,
  exclamationsPer100Words,
  countEmoji,
  hasThirdPersonSelfReference,
  countMarkerHits,
  buildReportJson,
  type AnswerRecord,
} from './render-pilot-metrics.js';

describe('extractJsonBlock', () => {
  it('extracts a bare JSON object', () => {
    expect(extractJsonBlock('{"a": 1}')).toBe('{"a": 1}');
  });

  it('strips markdown code fences', () => {
    expect(extractJsonBlock('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('takes the first {...} block when prose precedes it', () => {
    expect(extractJsonBlock('Sure, here you go: {"a": 1} thanks!')).toBe('{"a": 1}');
  });

  it('returns null when there is no JSON object', () => {
    expect(extractJsonBlock('no json here')).toBeNull();
  });
});

describe('parseSummaryResponse', () => {
  it('parses a well-formed summary response', () => {
    expect(parseSummaryResponse('{"summary": "hi"}')).toEqual({ summary: 'hi' });
  });

  it('returns null for a missing summary field', () => {
    expect(parseSummaryResponse('{"other": 1}')).toBeNull();
  });
});

describe('parseQuestionsResponse', () => {
  it('parses valid questions and drops malformed entries, counting them', () => {
    const raw = JSON.stringify({
      questions: [
        { q: 'q1', a: 'a1', basis: 'assistant' },
        { q: 'q2', a: 'a2', basis: 'bogus' },
        { q: 'q3' },
      ],
    });
    const result = parseQuestionsResponse(raw);
    expect(result.questions).toEqual([{ q: 'q1', a: 'a1', basis: 'assistant' }]);
    expect(result.dropped).toBe(2);
  });

  it('returns empty questions when the response has no questions array', () => {
    expect(parseQuestionsResponse('{}')).toEqual({ questions: [], dropped: 0 });
  });
});

describe('parseAnswerJudgement', () => {
  it('parses a full judgement', () => {
    expect(
      parseAnswerJudgement('{"correct": true, "faithful": false, "unsupported_claims": ["x"]}')
    ).toEqual({
      correct: true,
      faithful: false,
      unsupportedClaims: ['x'],
    });
  });

  it('returns null when correct/faithful are missing', () => {
    expect(parseAnswerJudgement('{"unsupported_claims": []}')).toBeNull();
  });
});

describe('parseSummaryJudgement', () => {
  it('parses a full judgement', () => {
    expect(
      parseSummaryJudgement(
        '{"faithful": true, "missing_commitments": [], "dangling_reference": false}'
      )
    ).toEqual({
      faithful: true,
      missingCommitments: [],
      danglingReference: false,
    });
  });
});

describe('parseFactsJudgement', () => {
  it('parses missing commitments', () => {
    expect(parseFactsJudgement('{"missing_commitments": ["promised to call"]}')).toEqual({
      missingCommitments: ['promised to call'],
    });
  });

  it('returns null for unparseable JSON', () => {
    expect(parseFactsJudgement('not json')).toBeNull();
  });
});

describe('decideSummaryOutcome', () => {
  it('accepts within-soft-cap without a retry', () => {
    const result = decideSummaryOutcome({ text: 'short', tokens: 40 }, null);
    expect(result).toEqual({ text: 'short', tokens: 40, state: 'within_soft' });
  });

  it('accepts the shorter retry when both are within the hard cap', () => {
    const result = decideSummaryOutcome(
      { text: 'longer one', tokens: 80 },
      { text: 'tighter', tokens: 70 }
    );
    expect(result).toEqual({ text: 'tighter', tokens: 70, state: 'regenerated' });
  });

  // Canary: mutating the overflow branch to slice/truncate the text must redden this test.
  it('flags overflow WITHOUT truncating the text when the shorter candidate still exceeds the hard cap', () => {
    const first = { text: 'A'.repeat(700), tokens: 150 };
    const retry = { text: 'B'.repeat(600), tokens: 120 };
    const result = decideSummaryOutcome(first, retry);
    expect(result.state).toBe('overflow');
    expect(result.text).toBe(retry.text);
    expect(result.text.length).toBe(600);
  });

  it('keeps the first candidate when no retry was made and it is over the hard cap', () => {
    const result = decideSummaryOutcome({ text: 'X'.repeat(500), tokens: 150 }, null);
    expect(result.state).toBe('overflow');
    expect(result.text).toBe('X'.repeat(500));
  });
});

describe('hasFirstPerson', () => {
  it('detects a bare first-person pronoun', () => {
    expect(hasFirstPerson('I went to the store')).toBe(true);
  });

  it('ignores first-person pronouns inside double quotes', () => {
    expect(hasFirstPerson('Nova said "I will be there" and smiled.')).toBe(false);
  });

  it('returns false with no first-person markers', () => {
    expect(hasFirstPerson('Nova went to the store')).toBe(false);
  });
});

describe('voice text metrics', () => {
  it('countWords counts whitespace-separated tokens', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('exclamationsPer100Words scales by word count', () => {
    expect(exclamationsPer100Words('hi! there!')).toBeCloseTo(100, 5);
  });

  it('countEmoji counts emoji characters', () => {
    expect(countEmoji('hello 🎉 world 🔥')).toBe(2);
    expect(countEmoji('no emoji here')).toBe(0);
  });

  it('hasThirdPersonSelfReference matches "<name> <verb>" outside quotes', () => {
    expect(hasThirdPersonSelfReference('Nova is happy today', 'Nova')).toBe(true);
    expect(hasThirdPersonSelfReference('"Nova is happy" she said', 'Nova')).toBe(false);
    expect(hasThirdPersonSelfReference('I am happy today', 'Nova')).toBe(false);
  });

  it('countMarkerHits is case-insensitive substring matching', () => {
    expect(countMarkerHits('The Vet appointment is set', ['vet', 'missing'])).toBe(1);
  });
});

describe('buildReportJson', () => {
  it('computes correctness rate and per-basis breakdown', () => {
    const answers: AnswerRecord[] = [
      {
        arm: 'V',
        basis: 'assistant',
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'x',
      },
      {
        arm: 'V',
        basis: 'user',
        judged: true,
        correct: false,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'y',
      },
    ];
    const json = buildReportJson({
      characterName: 'Nova',
      answers,
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [],
      usage: [],
      droppedMalformedQuestions: 0,
    }) as {
      arms: {
        V: { correctnessRate: number; correctnessByBasis: { assistant: number; user: number } };
      };
    };
    expect(json.arms.V.correctnessRate).toBe(0.5);
    expect(json.arms.V.correctnessByBasis).toEqual({ assistant: 1, user: 0 });
  });

  // Canary (G4): if an unjudged record is folded back into the rate denominator,
  // this reddens — correctness should stay 1.0 (2/2 judged-correct), not drop
  // to 2/3 by counting the unjudged miss as incorrect.
  it('excludes unjudged records from the correctness-rate denominator', () => {
    const answers: AnswerRecord[] = [
      {
        arm: 'V',
        basis: 'assistant',
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'x',
      },
      {
        arm: 'V',
        basis: 'assistant',
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'y',
      },
      {
        arm: 'V',
        basis: 'assistant',
        judged: false,
        correct: false,
        faithful: false,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: true,
        reply: 'z',
      },
    ];
    const json = buildReportJson({
      characterName: 'Nova',
      answers,
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [],
      usage: [],
      droppedMalformedQuestions: 0,
    });
    expect(json.arms.V.n).toBe(3);
    expect(json.arms.V.unjudged).toBe(1);
    expect(json.arms.V.correctnessRate).toBe(1);
  });

  // Canary (F4): truncation is observed at answer time, independent of the
  // judge — the denominator is every row (3), not just judged rows (2).
  // Flipping the finishReason==='length' comparison at the answer/voice
  // write site must redden this test.
  it('computes truncatedRate over ALL rows, not just judged ones', () => {
    const answers: AnswerRecord[] = [
      {
        arm: 'V',
        basis: 'assistant',
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: true,
        reply: 'x',
      },
      {
        arm: 'V',
        basis: 'assistant',
        judged: true,
        correct: true,
        faithful: true,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'y',
      },
      {
        arm: 'V',
        basis: 'assistant',
        judged: false,
        correct: false,
        faithful: false,
        unsupportedClaims: [],
        tailTokens: 10,
        truncated: false,
        reply: 'z',
      },
    ];
    const json = buildReportJson({
      characterName: 'Nova',
      answers,
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [],
      usage: [],
      droppedMalformedQuestions: 0,
    });
    expect(json.arms.V.truncatedRate).toBeCloseTo(1 / 3, 5);
  });
});
