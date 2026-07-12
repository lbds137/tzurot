import { describe, it, expect } from 'vitest';
import {
  buildExtractionPrompt,
  extractionResponseSchema,
  extractedFactSchema,
  extractJsonPayload,
} from './extractionPrompt.js';

describe('extractionResponseSchema', () => {
  const validFact = {
    statement: "Alice's cat is named Miso",
    entityTags: ['user:alice', 'pet:miso'],
    salience: 0.7,
    supersedesIndex: null,
  };

  it('accepts a valid response', () => {
    expect(extractionResponseSchema.safeParse({ facts: [validFact] }).success).toBe(true);
  });

  it('accepts an empty extraction (nothing durable found)', () => {
    expect(extractionResponseSchema.safeParse({ facts: [] }).success).toBe(true);
  });

  it('accepts a supersession by index', () => {
    const res = { facts: [{ ...validFact, supersedesIndex: 3 }] };
    expect(extractionResponseSchema.safeParse(res).success).toBe(true);
  });

  it('rejects a negative or fractional supersedesIndex', () => {
    expect(extractedFactSchema.safeParse({ ...validFact, supersedesIndex: -1 }).success).toBe(
      false
    );
    expect(extractedFactSchema.safeParse({ ...validFact, supersedesIndex: 1.5 }).success).toBe(
      false
    );
  });

  it('rejects out-of-range salience', () => {
    expect(extractedFactSchema.safeParse({ ...validFact, salience: 2 }).success).toBe(false);
  });

  it('rejects an over-long statement (extraction should be atomic)', () => {
    expect(
      extractedFactSchema.safeParse({ ...validFact, statement: 'x'.repeat(501) }).success
    ).toBe(false);
  });

  it('rejects a fact-bomb (more than 10 facts per batch)', () => {
    const res = { facts: Array.from({ length: 11 }, () => validFact) };
    expect(extractionResponseSchema.safeParse(res).success).toBe(false);
  });
});

describe('buildExtractionPrompt', () => {
  const episodes = ['{user}: my cat is named Miso\n{assistant}: Miso is a lovely name!'];

  it('numbers known facts for index-based supersession', () => {
    const prompt = buildExtractionPrompt(
      episodes,
      [
        {
          id: 'a',
          statement: 'Alice has a cat',
          entityTags: [],
          isLocked: false,
          tier: 'observed',
        },
        {
          id: 'b',
          statement: 'Alice lives in Seattle',
          entityTags: [],
          isLocked: false,
          tier: 'observed',
        },
      ],
      false
    );
    expect(prompt).toContain('[0] Alice has a cat');
    expect(prompt).toContain('[1] Alice lives in Seattle');
  });

  it('handles the empty known-facts case', () => {
    const prompt = buildExtractionPrompt(episodes, [], false);
    expect(prompt).toContain('(none known yet)');
  });

  it('includes the episode text and switches instruction by fiction scope', () => {
    const real = buildExtractionPrompt(episodes, [], false);
    const fiction = buildExtractionPrompt(episodes, [], true);
    expect(real).toContain('my cat is named Miso');
    expect(real).toContain('ignore in-story fiction');
    expect(fiction).toContain('in-story canon facts');
  });

  it('instructs the model to name the subject and never write "the user"', () => {
    // Statements are read back in later multi-user conversations where "the
    // user" no longer identifies anyone — the subject-naming rule keeps stored
    // facts bindable (backfilled "the user…" statements are handled render-side
    // by the facts-block subject instruction).
    const prompt = buildExtractionPrompt(episodes, [], false);
    expect(prompt).toContain("Name the fact's subject exactly as shown in the excerpts");
    expect(prompt).toContain('NEVER write "the user"');
    expect(prompt).toContain('keep a literal "{user}" placeholder verbatim');
  });
});

describe('extractJsonPayload', () => {
  const payload = '{"facts": []}';

  it('unwraps a ```json fence (the real Anthropic-via-OpenRouter shape)', () => {
    expect(extractJsonPayload('```json\n{"facts": []}\n```')).toBe(payload);
  });

  it('unwraps a bare ``` fence', () => {
    expect(extractJsonPayload('```\n{"facts": []}\n```')).toBe(payload);
  });

  it('passes bare JSON through untouched', () => {
    expect(extractJsonPayload(payload)).toBe(payload);
    expect(extractJsonPayload('  {"facts": []}  ')).toBe(payload);
  });

  it('does not unwrap a fence that only opens (malformed stays malformed)', () => {
    const malformed = '```json\n{"facts": []}';
    expect(extractJsonPayload(malformed)).toBe(malformed.trim());
  });
});
