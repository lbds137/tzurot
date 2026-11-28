import { describe, it, expect } from 'vitest';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { appendFooterToChunks } from './appendFooterToChunks.js';

describe('appendFooterToChunks', () => {
  it('appends the footer to the last chunk when it fits', () => {
    const chunks = ['first', 'last'];

    appendFooterToChunks(chunks, '\n-# Model: x');

    expect(chunks).toEqual(['first', 'last\n-# Model: x']);
  });

  it('pushes the footer as its own trimmed chunk when the last chunk would overflow', () => {
    const full = 'a'.repeat(DISCORD_LIMITS.MESSAGE_LENGTH);
    const chunks = [full];

    appendFooterToChunks(chunks, '\n-# Model: x');

    expect(chunks).toEqual([full, '-# Model: x']);
  });

  it('keeps the footer on the last chunk at exactly the limit', () => {
    const footer = '\n-# f';
    const last = 'a'.repeat(DISCORD_LIMITS.MESSAGE_LENGTH - footer.length);
    const chunks = [last];

    appendFooterToChunks(chunks, footer);

    expect(chunks).toEqual([last + footer]);
  });

  it('does nothing for an empty footer', () => {
    const chunks = ['only'];

    appendFooterToChunks(chunks, '');

    expect(chunks).toEqual(['only']);
  });

  it('does nothing for an empty chunk list', () => {
    const chunks: string[] = [];

    appendFooterToChunks(chunks, '\n-# f');

    expect(chunks).toEqual([]);
  });
});
