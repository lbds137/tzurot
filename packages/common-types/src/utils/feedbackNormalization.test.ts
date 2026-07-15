import { describe, it, expect } from 'vitest';
import { normalizeFeedbackContent, hashFeedbackContent } from './feedbackNormalization.js';

describe('normalizeFeedbackContent', () => {
  it('lowercases, collapses whitespace runs, and trims', () => {
    expect(normalizeFeedbackContent('  The   Bot\n\tIS   great  ')).toBe('the bot is great');
  });
});

describe('hashFeedbackContent', () => {
  it('produces a full 64-hex sha-256 (matches the VarChar(64) column)', () => {
    const hash = hashFeedbackContent('some feedback');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trivial variants of the same content hash identically', () => {
    expect(hashFeedbackContent('The bot is great')).toBe(
      hashFeedbackContent('  the   BOT is\ngreat ')
    );
  });

  it('different content hashes differently', () => {
    expect(hashFeedbackContent('the bot is great')).not.toBe(
      hashFeedbackContent('the bot is broken')
    );
  });
});
