import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { hashCharacterCard } from './characterCardChecksum.js';

describe('hashCharacterCard', () => {
  it('emits a full 64-hex digest, sized for the VarChar(64) column', () => {
    const digest = hashCharacterCard({ characterInfo: 'A quiet archivist.' });
    // 64, not 16: the repo's other sha-256 helper truncates and this one must
    // not — a truncated value in a 64-wide column throws away collision
    // resistance for nothing.
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the caller object key ordering', () => {
    const a = hashCharacterCard({ characterInfo: 'one', personalityTraits: 'two' });
    const b = hashCharacterCard({ personalityTraits: 'two', characterInfo: 'one' });
    expect(a).toBe(b);
  });

  it('changes when any single field changes', () => {
    const base = { characterInfo: 'one', personalityTraits: 'two' };
    expect(hashCharacterCard({ ...base, personalityTraits: 'three' })).not.toBe(
      hashCharacterCard(base)
    );
  });

  it('changes when a field is added or removed', () => {
    const base = { characterInfo: 'one' };
    expect(hashCharacterCard({ ...base, personalityTone: 'wry' })).not.toBe(
      hashCharacterCard(base)
    );
  });

  it('is CASE-SENSITIVE, so a rename regenerates the blurb', () => {
    // The deliberate departure from normalizeFeedbackContent. A blurb names its
    // character, so `emily` -> `Emily` is a real staleness event.
    expect(hashCharacterCard({ name: 'Emily' })).not.toBe(hashCharacterCard({ name: 'emily' }));
  });

  it('is insensitive to whitespace runs and surrounding space', () => {
    // The opposite call, for the opposite reason: a stray space changes nothing
    // a summarizer would write, and regenerating on it spends money for an
    // identical blurb.
    expect(hashCharacterCard({ characterInfo: '  a\n\n  quiet   archivist  ' })).toBe(
      hashCharacterCard({ characterInfo: 'a quiet archivist' })
    );
  });

  it('normalizes Unicode composition form', () => {
    // "café" composed (U+00E9) vs decomposed (e + U+0301). Identical to every
    // reader, so hashing them apart would buy a paid regeneration for a
    // difference nobody made.
    expect(hashCharacterCard({ characterInfo: 'caf\u00e9' })).toBe(
      hashCharacterCard({ characterInfo: 'cafe\u0301' })
    );
  });

  it('treats null, undefined, empty and whitespace-only as one absent state', () => {
    const absent = hashCharacterCard({ characterInfo: 'one', personalityTone: null });
    expect(hashCharacterCard({ characterInfo: 'one', personalityTone: undefined })).toBe(absent);
    expect(hashCharacterCard({ characterInfo: 'one', personalityTone: '' })).toBe(absent);
    expect(hashCharacterCard({ characterInfo: 'one', personalityTone: '   ' })).toBe(absent);
    // ...and identical to never supplying the key at all, so clearing a field
    // by any route is one state rather than four.
    expect(hashCharacterCard({ characterInfo: 'one' })).toBe(absent);
  });

  it('hashes a fully-empty card to the empty-string digest', () => {
    // Pins the property the summarizer's caller needs: "no content" is one shared
    // digest rather than a per-character one, so an empty card must be detected
    // by testing for THIS value, never by comparing two cards' checksums.
    const empty = createHash('sha256').update('').digest('hex');
    expect(hashCharacterCard({})).toBe(empty);
    expect(hashCharacterCard({ characterInfo: '', personalityTraits: '   ' })).toBe(empty);
  });

  it('distinguishes a value moving between two fields', () => {
    // The classic concatenation collision: without per-entry delimiting,
    // ('ab','c') and ('a','bc') hash the same.
    expect(hashCharacterCard({ characterInfo: 'ab', personalityTraits: 'c' })).not.toBe(
      hashCharacterCard({ characterInfo: 'a', personalityTraits: 'bc' })
    );
  });
});
