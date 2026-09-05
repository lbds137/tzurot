import { describe, it, expect } from 'vitest';
import {
  buildReportJson,
  type AnswerRecord,
  type SummaryRecord,
  type SummaryJudgeRecord,
  type FactsRecord,
  type VoiceRecord,
} from './render-pilot-metrics.js';
import { buildReportMarkdown, buildSpotCheckMarkdown } from './render-pilot-report-markdown.js';

describe('buildReportMarkdown — never leaks memory/reply/summary text', () => {
  const SENTINEL = 'SENTINEL-do-not-leak-12345';

  // Canary: if buildReportJson or buildReportMarkdown starts reading
  // `.reply`/`.summary` text fields, this reddens. Covers BOTH the JSON path
  // and the real markdown path (pooled + per-character sections) — a leak
  // reintroduced only in the markdown renderer would otherwise slip past.
  it('does not leak a sentinel embedded in reply/summary text into the report JSON or markdown', () => {
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
        reply: SENTINEL,
      },
    ];
    const summaries: SummaryRecord[] = [
      {
        tokens: 20,
        state: 'within_soft',
        hasFirstPerson: false,
        parseFailed: false,
        summary: SENTINEL,
      },
    ];
    const summaryJudgements: SummaryJudgeRecord[] = [
      {
        judged: true,
        faithful: true,
        danglingReference: false,
        missingCommitments: [],
        hasReferenced: false,
      },
    ];
    const facts: FactsRecord[] = [{ hadFacts: true, missingCommitments: [] }];
    const voice: VoiceRecord[] = [
      {
        arm: 'V',
        chars: 10,
        words: 2,
        exclamationsPer100Words: 0,
        emojiCount: 0,
        thirdPersonSelfReference: false,
        markerHits: 0,
        truncated: false,
        reply: SENTINEL,
      },
    ];

    const json = buildReportJson({
      characterName: 'Nova',
      answers,
      summaries,
      summaryJudgements,
      facts,
      voice,
      usage: [],
      droppedMalformedQuestions: 0,
    });
    const jsonText = JSON.stringify(json);
    expect(jsonText).not.toContain(SENTINEL);

    const markdown = buildReportMarkdown({ perCharacter: { nova: json }, pooled: json });
    expect(markdown).not.toContain(SENTINEL);
  });

  it('renders pooled section first, then one section per character', () => {
    const json = buildReportJson({
      characterName: 'Nova',
      answers: [],
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [],
      usage: [],
      droppedMalformedQuestions: 0,
    });
    const markdown = buildReportMarkdown({
      perCharacter: { nova: json, luna: json },
      pooled: json,
    });
    expect(markdown.indexOf('Pooled (all characters)')).toBeLessThan(
      markdown.indexOf('Character: nova')
    );
    expect(markdown).toContain('Character: luna');
    expect(markdown).toContain('| Arm | n |');
  });

  // Canary (F4): flipping the truncated-comparison in armAnswerStats/voiceArmStats
  // must redden this test — both tables must carry a Truncated column and reflect it.
  it('renders a Truncated column in both the answers table and the voice table', () => {
    const json = buildReportJson({
      characterName: 'Nova',
      answers: [
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
      ],
      summaries: [],
      summaryJudgements: [],
      facts: [],
      voice: [
        {
          arm: 'V',
          chars: 10,
          words: 2,
          exclamationsPer100Words: 0,
          emojiCount: 0,
          thirdPersonSelfReference: false,
          markerHits: 0,
          truncated: true,
          reply: 'y',
        },
      ],
      usage: [],
      droppedMalformedQuestions: 0,
    });
    const markdown = buildReportMarkdown({ perCharacter: {}, pooled: json });
    expect(markdown).toContain('Truncated');
    expect(markdown).toContain('100.0%');
  });
});

describe('buildSpotCheckMarkdown', () => {
  it('includes the LOCAL-ONLY warning header and every row verbatim', () => {
    const md = buildSpotCheckMarkdown('Nova', [
      {
        id: 'm1',
        createdAt: '2026-01-01',
        verbatim: 'Alice: hi',
        renderF: '<historical_note>F</historical_note>',
        renderS: '<historical_note>S</historical_note>',
      },
    ]);
    expect(md).toContain('LOCAL-ONLY');
    expect(md).toContain('Alice: hi');
    expect(md).toContain('<historical_note>F</historical_note>');
  });
});
