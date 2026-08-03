import { describe, it, expect } from 'vitest';

import { createMockPersonality } from '../../test/mocks/fixtures/personality.js';
import {
  buildJudgePrompt,
  buildPersonaCard,
  parseJudgeVerdict,
  resolveSwappedVerdicts,
  type JudgeVerdict,
} from './voiceJudgePrompt.js';

const verdict = (
  winner: JudgeVerdict['winner'],
  violations: JudgeVerdict['violations'] = []
): JudgeVerdict => ({ winner, margin: 1, violations, rationale: 'r' });

describe('buildPersonaCard', () => {
  it('includes populated fields and the verbatim protocol, omits empty ones', () => {
    const card = buildPersonaCard(
      createMockPersonality({
        personalityTone: 'wry',
        systemPrompt: '<rules>no emoji</rules>',
        personalityLikes: undefined,
      })
    );
    expect(card).toContain('Name: TestBot');
    expect(card).toContain('Tone: wry');
    expect(card).toContain('<rules>no emoji</rules>');
    expect(card).not.toContain('Likes:');
  });
});

describe('buildJudgePrompt', () => {
  it('carries the anti-bias rule, both responses, and the JSON contract', () => {
    const prompt = buildJudgePrompt({
      personaCard: 'Name: X',
      recentTurns: [{ speaker: 'Vee', text: 'hi' }],
      triggerText: 'so?',
      response1: 'AAA',
      response2: 'BBB',
    });
    expect(prompt).toContain('do NOT reward length');
    expect(prompt).toContain('RESPONSE 1\nAAA');
    expect(prompt).toContain('RESPONSE 2\nBBB');
    expect(prompt).toContain('"winner"');
    expect(prompt).toContain('Vee: hi');
  });
});

describe('parseJudgeVerdict', () => {
  it('parses a clean JSON verdict', () => {
    const parsed = parseJudgeVerdict(
      '{"winner": "2", "margin": 1, "violations": [{"response": "1", "kind": "markup-leak", "quote": "<from>"}], "rationale": "leak"}'
    );
    expect(parsed.winner).toBe('2');
    expect(parsed.violations).toEqual([{ response: '1', kind: 'markup-leak', quote: '<from>' }]);
  });

  it('extracts the object from fenced/prose-wrapped output', () => {
    const parsed = parseJudgeVerdict(
      'Here is my judgment:\n```json\n{"winner": "tie", "margin": 0, "violations": [], "rationale": ""}\n```\n'
    );
    expect(parsed.winner).toBe('tie');
  });

  it('throws on missing JSON and on an invalid winner', () => {
    expect(() => parseJudgeVerdict('no json here')).toThrow(/no JSON object/);
    expect(() => parseJudgeVerdict('{"winner": "both"}')).toThrow(/winner is invalid/);
  });

  it('drops malformed violation entries rather than failing the call', () => {
    const parsed = parseJudgeVerdict(
      '{"winner": "1", "margin": 0, "violations": [{"response": "3"}, "junk", {"response": "2"}], "rationale": ""}'
    );
    expect(parsed.violations).toEqual([{ response: '2', kind: 'unspecified', quote: '' }]);
  });
});

describe('resolveSwappedVerdicts (position-consistency)', () => {
  it('a side wins only when both orders agree', () => {
    // forward: left shown as 1; swapped: left shown as 2.
    expect(resolveSwappedVerdicts(verdict('1'), verdict('2')).winner).toBe('left');
    expect(resolveSwappedVerdicts(verdict('2'), verdict('1')).winner).toBe('right');
  });

  it('disagreement or any tie resolves to tie (position bias neutralized)', () => {
    expect(resolveSwappedVerdicts(verdict('1'), verdict('1')).winner).toBe('tie'); // pure position bias
    expect(resolveSwappedVerdicts(verdict('1'), verdict('tie')).winner).toBe('tie');
    expect(resolveSwappedVerdicts(verdict('tie'), verdict('tie')).winner).toBe('tie');
  });

  it('maps violations from both calls back to canonical sides and dedups', () => {
    const forward = verdict('tie', [{ response: '1', kind: 'leak', quote: 'x' }]); // 1=left
    const swapped = verdict('tie', [
      { response: '2', kind: 'leak', quote: 'x' }, // 2=left in the swapped call → duplicate
      { response: '1', kind: 'identity', quote: 'y' }, // 1=right in the swapped call
    ]);
    const resolved = resolveSwappedVerdicts(forward, swapped);
    expect(resolved.violations).toEqual([
      { side: 'left', kind: 'leak', quote: 'x' },
      { side: 'right', kind: 'identity', quote: 'y' },
    ]);
  });
});
