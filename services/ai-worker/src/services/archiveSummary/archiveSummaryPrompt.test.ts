import { describe, it, expect } from 'vitest';
import {
  buildSummarizerPrompt,
  buildRegeneratePrompt,
  buildReferentCheckPrompt,
  REFERENT_CHECK_SYSTEM_PROMPT,
  summaryResponseSchema,
  referentCheckResponseSchema,
  type SummarizerMessageInput,
} from './archiveSummaryPrompt.js';

const BASE_INPUT: SummarizerMessageInput = {
  displayName: 'Nova',
  subjectName: 'Jules',
  userText: 'can you remind me to call the vet tomorrow at 9?',
  assistantText: "Got it — I'll bring it up first thing tomorrow morning.",
  referenced: null,
};

describe('buildSummarizerPrompt', () => {
  it('contains the system rules and every supplied field', () => {
    const prompt = buildSummarizerPrompt(BASE_INPUT);
    expect(prompt).toContain('Write in third person');
    expect(prompt).toContain('at most 60 words total');
    expect(prompt).toContain(BASE_INPUT.displayName);
    expect(prompt).toContain(BASE_INPUT.subjectName);
    expect(prompt).toContain(BASE_INPUT.userText);
    expect(prompt).toContain(BASE_INPUT.assistantText);
  });

  it('includes the referenced-content block when non-null', () => {
    const prompt = buildSummarizerPrompt({ ...BASE_INPUT, referenced: 'a prior plan to hike' });
    expect(prompt).toContain('[Referenced content: a prior plan to hike]');
  });

  it('omits the referenced-content block for THIS exchange when null', () => {
    // The system prompt's own rules and worked examples legitimately contain
    // the literal string "[Referenced content:" — a naive whole-prompt
    // substring check can't distinguish that from a block for BASE_INPUT's
    // own exchange, so this asserts the prompt's own tail (this call's user
    // message — `buildSummarizerPrompt` appends it after the system rules,
    // so it is the tail of the string) ends immediately after the assistant
    // line with no trailing block.
    const prompt = buildSummarizerPrompt(BASE_INPUT);
    expect(prompt.trimEnd().endsWith(`Nova: ${BASE_INPUT.assistantText}`)).toBe(true);
  });
});

describe('buildRegeneratePrompt', () => {
  it('carries the previous summary and every feedback line', () => {
    const prompt = buildRegeneratePrompt(BASE_INPUT, 'The old summary text.', [
      'over the length cap',
      'contains a first-person pronoun',
      'names: the plan, the vet',
    ]);
    expect(prompt).toContain('The old summary text.');
    expect(prompt).toContain('over the length cap');
    expect(prompt).toContain('contains a first-person pronoun');
    expect(prompt).toContain('names: the plan, the vet');
    expect(prompt).toContain('Tighter');
    expect(prompt).toContain('keep every commitment and every name');
    expect(prompt).toContain('third person');
  });
});

describe('buildReferentCheckPrompt', () => {
  it('carries the referent-check rules and the exchange plus summary', () => {
    const prompt = buildReferentCheckPrompt(BASE_INPUT, 'Jules asked Nova about the vet call.');
    expect(prompt).toContain(REFERENT_CHECK_SYSTEM_PROMPT);
    expect(prompt).toContain(BASE_INPUT.userText);
    expect(prompt).toContain('Jules asked Nova about the vet call.');
  });
});

describe('summaryResponseSchema', () => {
  it('accepts a non-empty summary', () => {
    expect(summaryResponseSchema.safeParse({ summary: 'A summary.' }).success).toBe(true);
  });

  it('rejects an empty summary', () => {
    expect(summaryResponseSchema.safeParse({ summary: '' }).success).toBe(false);
  });
});

describe('referentCheckResponseSchema', () => {
  it('accepts an empty dangling list', () => {
    expect(referentCheckResponseSchema.safeParse({ dangling: [] }).success).toBe(true);
  });

  it('rejects a non-array dangling field', () => {
    expect(referentCheckResponseSchema.safeParse({ dangling: 'nope' }).success).toBe(false);
  });
});
