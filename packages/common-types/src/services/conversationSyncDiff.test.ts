import { describe, it, expect } from 'vitest';
import {
  collateChunksForSync,
  contentsDiffer,
  getOldestObservedTimestamp,
  type ObservedSyncMessage,
} from './conversationSyncDiff.js';

describe('collateChunksForSync', () => {
  const dbMsg = { discordMessageId: ['d1', 'd2'], content: 'part one part two' };

  it('collates chunks in the order of the DB discordMessageId array', () => {
    // Pass chunks out of order — collation must restore d1 → d2
    const result = collateChunksForSync('db-1', dbMsg, [
      { id: 'd2', content: ' part two' },
      { id: 'd1', content: 'part one' },
    ]);
    expect(result).toBe('part one part two');
  });

  it('does not mutate the caller-provided chunk array order', () => {
    const chunks = [
      { id: 'd2', content: ' part two' },
      { id: 'd1', content: 'part one' },
    ];
    collateChunksForSync('db-1', dbMsg, chunks);
    expect(chunks[0].id).toBe('d2');
  });

  it('returns null when chunks are missing (partial Discord fetch)', () => {
    const result = collateChunksForSync('db-1', dbMsg, [{ id: 'd1', content: 'part one' }]);
    expect(result).toBeNull();
  });

  it('strips the DM display-name prefix before comparison', () => {
    const result = collateChunksForSync(
      'db-1',
      { discordMessageId: ['d1'], content: 'hello there' },
      [{ id: 'd1', content: '**Lila:** hello there' }]
    );
    expect(result).toBe('hello there');
  });

  it('returns null when stripping shrinks content by more than 80%', () => {
    const longDbContent = 'x'.repeat(100);
    const result = collateChunksForSync(
      'db-1',
      { discordMessageId: ['d1'], content: longDbContent },
      [{ id: 'd1', content: '**Lila:** tiny' }]
    );
    expect(result).toBeNull();
  });
});

describe('contentsDiffer', () => {
  it('returns false for identical content', () => {
    expect(contentsDiffer('same', 'same')).toBe(false);
  });

  it('returns false when Discord content is empty but DB has content (voice transcripts)', () => {
    expect(contentsDiffer('', 'transcribed words')).toBe(false);
  });

  it('returns false when DB content only adds a [Name]: prefix', () => {
    expect(contentsDiffer('hello', '[Lila]: hello')).toBe(false);
  });

  it('returns true for genuinely different content', () => {
    expect(contentsDiffer('edited words', 'original words')).toBe(true);
  });

  it('returns true when prefixed DB content differs beyond the prefix', () => {
    expect(contentsDiffer('edited', '[Lila]: original')).toBe(true);
  });
});

describe('getOldestObservedTimestamp', () => {
  const msg = (id: string, iso: string): ObservedSyncMessage => ({
    id,
    content: '',
    createdAt: new Date(iso),
  });

  it('returns the oldest timestamp', () => {
    const oldest = getOldestObservedTimestamp([
      msg('a', '2026-06-02T00:00:00Z'),
      msg('b', '2026-06-01T00:00:00Z'),
      msg('c', '2026-06-03T00:00:00Z'),
    ]);
    expect(oldest?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns null for an empty list', () => {
    expect(getOldestObservedTimestamp([])).toBeNull();
  });
});
