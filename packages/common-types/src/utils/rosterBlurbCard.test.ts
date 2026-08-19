import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildRosterBlurbCard,
  EMPTY_ROSTER_BLURB_CARD_HASH,
  hashRosterBlurbCard,
  ROSTER_BLURB_CARD_FIELDS,
  type RosterBlurbCard,
} from './rosterBlurbCard.js';

function emptyCard(): RosterBlurbCard {
  return Object.fromEntries(ROSTER_BLURB_CARD_FIELDS.map(k => [k, null])) as RosterBlurbCard;
}

function fullCard(): RosterBlurbCard {
  return Object.fromEntries(
    ROSTER_BLURB_CARD_FIELDS.map(k => [k, `value-for-${k}`])
  ) as RosterBlurbCard;
}

describe('ROSTER_BLURB_CARD_FIELDS', () => {
  it('satisfies hashCharacterCard key precondition: no colon, no whitespace', () => {
    // The entry encoding is `key:length:value` joined on newlines, and keys —
    // unlike values — are NOT normalized on the way in. A rename introducing
    // either character would silently degrade collision resistance.
    for (const key of ROSTER_BLURB_CARD_FIELDS) {
      expect(key).not.toContain(':');
      expect(key).not.toMatch(/\s/u);
    }
  });

  it('has no duplicate keys', () => {
    expect(new Set(ROSTER_BLURB_CARD_FIELDS).size).toBe(ROSTER_BLURB_CARD_FIELDS.length);
  });

  it('excludes the fields ruled out for the summarizer', () => {
    const keys = new Set<string>(ROSTER_BLURB_CARD_FIELDS);
    for (const excluded of [
      'conversationalExamples',
      'errorMessage',
      'customFields',
      'birthMonth',
      'birthDay',
      'birthYear',
    ]) {
      expect(keys.has(excluded)).toBe(false);
    }
  });
});

describe('buildRosterBlurbCard', () => {
  it('drops everything outside the summarizer field set', () => {
    const card = buildRosterBlurbCard({
      ...fullCard(),
      errorMessage: 'nope',
      customFields: 'nope',
    } as RosterBlurbCard);

    expect(Object.keys(card).sort()).toEqual([...ROSTER_BLURB_CARD_FIELDS].sort());
  });

  it('hashes a row identically whether or not it carries extra columns', () => {
    const withExtras = { ...fullCard(), errorMessage: 'nope' } as RosterBlurbCard;

    expect(hashRosterBlurbCard(withExtras)).toBe(hashRosterBlurbCard(fullCard()));
  });
});

describe('hashRosterBlurbCard', () => {
  it.each([...ROSTER_BLURB_CARD_FIELDS])('a change to %s moves the hash', key => {
    const base = fullCard();

    expect(hashRosterBlurbCard({ ...base, [key]: 'CHANGED' })).not.toBe(hashRosterBlurbCard(base));
  });

  it('is stable across identical cards', () => {
    expect(hashRosterBlurbCard(fullCard())).toBe(hashRosterBlurbCard(fullCard()));
  });

  it('collapses every empty card onto the sha-256 of the empty string', () => {
    const expected = createHash('sha256').update('').digest('hex');

    expect(EMPTY_ROSTER_BLURB_CARD_HASH).toBe(expected);
    expect(hashRosterBlurbCard(emptyCard())).toBe(expected);
    expect(hashRosterBlurbCard({ ...emptyCard(), name: '   ', characterInfo: '' })).toBe(expected);
  });
});
