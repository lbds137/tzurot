import { describe, it, expect } from 'vitest';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { buildEditedChunks, extractDmPrefix } from './chunkPlan.js';

describe('extractDmPrefix', () => {
  it('rebuilds the speaker prefix from a live DM message', () => {
    expect(extractDmPrefix('**Lilith:** Hello there')).toBe('**Lilith:** ');
  });

  it('returns an empty string when the message has no prefix', () => {
    expect(extractDmPrefix('Hello there')).toBe('');
  });
});

describe('buildEditedChunks', () => {
  it('returns one chunk with the footer appended for short text', () => {
    expect(buildEditedChunks('New text', '', '\n-# footer')).toEqual(['New text\n-# footer']);
  });

  it('puts the DM prefix on the first chunk only', () => {
    const long = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;

    const chunks = buildEditedChunks(long, '**Lilith:** ', '');

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith('**Lilith:** ')).toBe(true);
    expect(chunks.slice(1).every(c => !c.startsWith('**Lilith:**'))).toBe(true);
  });

  it('keeps every chunk within the Discord message limit', () => {
    const chunks = buildEditedChunks('word '.repeat(1200), '', '\n-# footer');

    expect(chunks.every(c => c.length <= DISCORD_LIMITS.MESSAGE_LENGTH)).toBe(true);
  });

  it('moves an overflowing footer into its own trailing chunk', () => {
    const text = 'a'.repeat(DISCORD_LIMITS.MESSAGE_LENGTH);

    const chunks = buildEditedChunks(text, '', '\n-# footer');

    expect(chunks[chunks.length - 1]).toBe('-# footer');
  });
});
