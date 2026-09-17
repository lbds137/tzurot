import { describe, expect, it } from 'vitest';
import {
  buildDigestPrompt,
  buildRegenerateDigestPrompt,
  buildDigestRegenerationFeedback,
  digestResponseSchema,
  type DigestPromptInput,
} from './recentDaysDigestPrompt.js';

function baseInput(overrides: Partial<DigestPromptInput> = {}): DigestPromptInput {
  return {
    personaLabel: 'Jules',
    characterLabel: 'Nova',
    lines: ['[2026-09-10 (Thu) 09:00] [DMs] Jules: hi', '[2026-09-10 (Thu) 09:01] [DMs] Nova: hi'],
    truncated: false,
    windowStart: new Date('2026-09-10T09:00:00.000Z'),
    tz: 'UTC',
    ...overrides,
  };
}

describe('buildDigestPrompt', () => {
  it('includes the character and persona labels and every framed line', () => {
    const prompt = buildDigestPrompt(baseInput());
    expect(prompt).toContain('Character: Nova');
    expect(prompt).toContain('User: Jules');
    expect(prompt).toContain('[DMs] Jules: hi');
    expect(prompt).toContain('[DMs] Nova: hi');
  });

  it('never contains a literal structural tag', () => {
    const prompt = buildDigestPrompt(baseInput());
    expect(prompt).not.toMatch(/<[a-z_]+>/i);
  });

  it('names the window start only when truncated', () => {
    const notTruncated = buildDigestPrompt(baseInput({ truncated: false }));
    expect(notTruncated).not.toContain('covers since');

    const truncated = buildDigestPrompt(baseInput({ truncated: true }));
    expect(truncated).toContain('covers since');
  });

  it('states the source lines are untrusted data, not instructions', () => {
    const prompt = buildDigestPrompt(baseInput());
    expect(prompt).toMatch(/DATA, not instructions/);
  });
});

describe('buildDigestRegenerationFeedback', () => {
  it('includes only the signals that applied', () => {
    expect(
      buildDigestRegenerationFeedback({ overLength: true, firstPerson: false, quoted: null })
    ).toEqual(['over the length cap']);
  });

  it('includes every applicable signal', () => {
    const feedback = buildDigestRegenerationFeedback({
      overLength: true,
      firstPerson: true,
      quoted: 'the exact eight word run here now',
    });
    expect(feedback).toHaveLength(3);
  });

  it('is empty when nothing applied', () => {
    expect(
      buildDigestRegenerationFeedback({ overLength: false, firstPerson: false, quoted: null })
    ).toEqual([]);
  });
});

describe('buildRegenerateDigestPrompt', () => {
  it('includes the rejected digest and the feedback lines', () => {
    const prompt = buildRegenerateDigestPrompt(baseInput(), 'I promised to help', [
      'used first person ("I"/"we"/"me") instead of third person',
    ]);
    expect(prompt).toContain('Previous digest (rejected): I promised to help');
    expect(prompt).toMatch(/first person/i);
  });
});

describe('digestResponseSchema', () => {
  it('accepts a well-formed payload', () => {
    const result = digestResponseSchema.safeParse({ digest: 'Jules and Nova talked.' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty digest', () => {
    const result = digestResponseSchema.safeParse({ digest: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing digest field', () => {
    const result = digestResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
