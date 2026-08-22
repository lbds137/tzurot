import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRole, MESSAGE_LIMITS } from '@tzurot/common-types/constants/message';

// Hoisted singleton so log-field assertions can inspect what was emitted.
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: vi.fn(() => mockLogger) };
});

import {
  resolveSpeakerInfo,
  extractParticipants,
  extractCharacterParticipants,
} from './participantUtils.js';
import type { StructuredHistoryEntry } from './conversationTypes.js';

describe('resolveSpeakerInfo', () => {
  const msg = (overrides: Partial<StructuredHistoryEntry>): StructuredHistoryEntry =>
    ({ role: 'user', content: 'hi', ...overrides }) as StructuredHistoryEntry;

  describe('assistant messages', () => {
    it("keeps role='assistant' for the responding persona's own message", () => {
      const result = resolveSpeakerInfo(
        msg({ role: 'assistant', personalityName: 'Yeshua' }),
        'Yeshua'
      );
      expect(result).toMatchObject({ speakerName: 'Yeshua', role: 'assistant' });
    });

    it("demotes a sibling persona's message to role='character'", () => {
      // Presenting Ha-Shem's lines as role="assistant" tells Yeshua they're its
      // own words — the multi-persona identity-confusion bug this rule kills.
      const result = resolveSpeakerInfo(
        msg({ role: 'assistant', personalityName: 'Ha-Shem' }),
        'Yeshua'
      );
      expect(result).toMatchObject({ speakerName: 'Ha-Shem', role: 'character' });
    });

    it('compares persona names case-insensitively', () => {
      const result = resolveSpeakerInfo(
        msg({ role: 'assistant', personalityName: 'yeshua' }),
        'Yeshua'
      );
      expect(result?.role).toBe('assistant');
    });

    it("falls back to role='assistant' for legacy rows without a stored personalityName", () => {
      const result = resolveSpeakerInfo(msg({ role: 'assistant' }), 'Yeshua');
      expect(result).toMatchObject({ speakerName: 'Yeshua', role: 'assistant' });
    });

    it("keeps role='assistant' for the persona's own row attributed by webhook DISPLAY name", () => {
      // The extended-context registry-miss fallback stores the webhook display
      // name ("Yeshua ben Yosef ▽"), not personality.name ("Yeshua") — a strict
      // compare would demote the persona's own line to 'character'.
      const result = resolveSpeakerInfo(
        msg({ role: 'assistant', personalityName: 'Yeshua ben Yosef ▽' }),
        'Yeshua'
      );
      expect(result?.role).toBe('assistant');
    });

    it("demotes a sibling attributed by display name to role='character'", () => {
      const result = resolveSpeakerInfo(
        msg({ role: 'assistant', personalityName: 'Ha-Shem ▽' }),
        'Yeshua'
      );
      expect(result?.role).toBe('character');
    });

    describe('whitespace-padded names', () => {
      // Neither Personality.name nor the webhook display name is trimmed by a
      // schema, and the roster renders the TRIMMED form — so a name that
      // renders identically to the responder's must resolve to the same role.
      // A trailing pad was always absorbed by the prefix test; a LEADING pad
      // on either side breaks it, which is the reachable half of the class.

      it("keeps role='assistant' when the responder's own name is padded", () => {
        const result = resolveSpeakerInfo(
          msg({ role: 'assistant', personalityName: 'Yeshua' }),
          ' Yeshua '
        );
        expect(result?.role).toBe('assistant');
      });

      it("keeps role='assistant' when the stored row name is padded", () => {
        const result = resolveSpeakerInfo(
          msg({ role: 'assistant', personalityName: ' Yeshua ' }),
          'Yeshua'
        );
        expect(result?.role).toBe('assistant');
      });

      it('does not claim every row as its own when the responder name is blank', () => {
        // Post-trim a whitespace-only name is '', and startsWith('') matches
        // every string — without a guard the responder would claim an
        // unrelated sibling's line as its own words.
        const result = resolveSpeakerInfo(
          msg({ role: 'assistant', personalityName: 'Ha-Shem' }),
          '   '
        );
        expect(result?.role).toBe('character');
      });

      it("still demotes a genuine sibling when the responder's name is padded", () => {
        const result = resolveSpeakerInfo(
          msg({ role: 'assistant', personalityName: 'Ha-Shem' }),
          ' Yeshua '
        );
        expect(result?.role).toBe('character');
      });

      it('leaves the rendered speaker name untouched', () => {
        // Comparisons normalize; the stored/rendered value does not. `from=`
        // carries these bytes verbatim, so trimming here would move prompt
        // bytes for every padded-name channel.
        const result = resolveSpeakerInfo(
          msg({ role: 'assistant', personalityName: ' Yeshua ' }),
          'Yeshua'
        );
        expect(result?.speakerName).toBe(' Yeshua ');
      });
    });
  });

  describe('user messages', () => {
    it('uses the persona name with role=user', () => {
      const result = resolveSpeakerInfo(msg({ personaName: 'Robin' }), 'Yeshua');
      expect(result).toMatchObject({ speakerName: 'Robin', role: 'user' });
    });

    it('disambiguates a user whose persona name collides with the responding personality', () => {
      const result = resolveSpeakerInfo(
        msg({ personaName: 'Yeshua', discordUsername: 'robin123' }),
        'Yeshua'
      );
      expect(result?.speakerName).toBe('Yeshua (@robin123)');
    });

    it('disambiguates against ANY personality name in the conversation', () => {
      const result = resolveSpeakerInfo(
        msg({ personaName: 'Lila', discordUsername: 'lbds137' }),
        'Yeshua',
        new Set(['Lila', 'Yeshua'])
      );
      expect(result?.speakerName).toBe('Lila (@lbds137)');
    });

    it('disambiguates a padded persona name against a clean personality name', () => {
      // Neither name is schema-trimmed and the roster renders the trimmed
      // form, so these two are indistinguishable to a reader — exactly the
      // confusion the disambiguation exists for.
      const result = resolveSpeakerInfo(
        msg({ personaName: ' Yeshua ', discordUsername: 'robin123' }),
        'Yeshua'
      );
      expect(result?.speakerName).toBe(' Yeshua  (@robin123)');
    });

    it('does not disambiguate a persona name that renders as nothing', () => {
      // Both trim to '' and compare equal, but neither renders — appending a
      // username to an empty display name disambiguates nothing.
      const result = resolveSpeakerInfo(
        msg({ personaName: '   ', discordUsername: 'robin123' }),
        ' '
      );
      expect(result?.speakerName).toBe('   ');
    });

    it('disambiguates against a padded entry in the personality-name set', () => {
      const result = resolveSpeakerInfo(
        msg({ personaName: 'Lila', discordUsername: 'lbds137' }),
        'Yeshua',
        new Set([' Lila ', 'Yeshua'])
      );
      expect(result?.speakerName).toBe('Lila (@lbds137)');
    });
  });

  it('returns null for system/unknown roles', () => {
    expect(resolveSpeakerInfo(msg({ role: 'system' }), 'Yeshua')).toBeNull();
  });
});

describe('extractParticipants', () => {
  it('collects unique user personas and marks the active one', () => {
    const history = [
      { role: MessageRole.User, content: 'a', personaId: 'p1', personaName: 'Robin' },
      { role: MessageRole.Assistant, content: 'b' },
      { role: MessageRole.User, content: 'c', personaId: 'p2', personaName: 'Lila' },
      { role: MessageRole.User, content: 'd', personaId: 'p1', personaName: 'Robin' },
    ];
    const result = extractParticipants(history, 'p2', 'Lila');
    expect(result).toHaveLength(2);
    expect(result.find(p => p.personaId === 'p2')?.isActive).toBe(true);
    expect(result.find(p => p.personaId === 'p1')?.isActive).toBe(false);
  });

  it('includes the active persona even when absent from history', () => {
    const result = extractParticipants([], 'p9', 'Newcomer');
    expect(result).toEqual([{ personaId: 'p9', personaName: 'Newcomer', isActive: true }]);
  });

  describe('logging omits persona display names', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const run = (): void => {
      extractParticipants(
        [
          { role: MessageRole.User, content: 'a', personaId: 'p1', personaName: 'Robin' },
          { role: MessageRole.User, content: 'c', personaId: 'p2', personaName: 'Lila' },
        ],
        'p2',
        'Lila'
      );
    };

    const debugFields = (): Record<string, unknown>[] =>
      mockLogger.debug.mock.calls.map(call => call[0] as Record<string, unknown>);

    it('logs participant ids and a count, not their names', () => {
      run();

      const found = debugFields().find(f => 'participantIds' in f);
      expect(found).toMatchObject({ count: 2, participantIds: ['p1', 'p2'] });
      expect(found).not.toHaveProperty('participantNames');
    });

    it('reports the active persona by id and name-presence, never by name', () => {
      run();

      const extracting = debugFields().find(f => 'activePersonaId' in f);
      expect(extracting).toMatchObject({ activePersonaId: 'p2', hasActivePersonaName: true });
      expect(extracting).not.toHaveProperty('activePersonaName');
    });

    it('reports hasActivePersonaName false when there is no active name', () => {
      // The true branch alone would leave the condition unguarded — flipping
      // `&&` to `||`, or dropping the length check, still passes a test that
      // only ever supplies a name. Both inputs that should read false:
      // undefined, and the empty string.
      extractParticipants([{ role: MessageRole.User, content: 'a', personaId: 'p1' }], 'p1');
      expect(debugFields().find(f => 'activePersonaId' in f)).toMatchObject({
        hasActivePersonaName: false,
      });

      vi.clearAllMocks();
      extractParticipants([{ role: MessageRole.User, content: 'a', personaId: 'p1' }], 'p1', '');
      expect(debugFields().find(f => 'activePersonaId' in f)).toMatchObject({
        hasActivePersonaName: false,
      });
    });

    it('emits no persona display name in any log field', () => {
      run();

      const serialised = JSON.stringify(debugFields());
      expect(serialised).not.toContain('Robin');
      expect(serialised).not.toContain('Lila');
    });
  });
});

describe('extractCharacterParticipants', () => {
  const entry = (overrides: Partial<StructuredHistoryEntry>): StructuredHistoryEntry =>
    ({ role: 'assistant', content: 'hi', ...overrides }) as StructuredHistoryEntry;

  it('excludes the responder from its own roster when the name path decides and the name is padded', () => {
    // The row HAS a personalityId; the name path runs because no
    // responderPersonalityId is supplied, which is the id-less fallback this
    // heuristic still serves. The membership test is resolveSpeakerInfo's
    // role, so an untrimmed compare put the RESPONDER into its own
    // <character_participant> roster, showing the personality to itself as a
    // peer.
    const result = extractCharacterParticipants(
      [entry({ personalityId: 'p-self', personalityName: 'Lilith' })],
      ' Lilith '
    );

    expect(result).toEqual([]);
  });

  it('collects a sibling character with its personality id and name', () => {
    const result = extractCharacterParticipants(
      [entry({ personalityId: 'p-kai', personalityName: 'Kai' })],
      'Lilith'
    );

    expect(result).toEqual([{ personalityId: 'p-kai', personalityName: 'Kai' }]);
  });

  it("excludes the responding personality's own lines", () => {
    const result = extractCharacterParticipants(
      [
        entry({ personalityId: 'p-lilith', personalityName: 'Lilith' }),
        entry({ personalityId: 'p-kai', personalityName: 'Kai' }),
      ],
      'Lilith'
    );

    expect(result.map(c => c.personalityId)).toEqual(['p-kai']);
  });

  it('ignores user messages, which carry a persona rather than a personality', () => {
    const result = extractCharacterParticipants(
      [entry({ role: 'user', personaId: 'persona-1', personaName: 'Alice' })],
      'Lilith'
    );

    expect(result).toEqual([]);
  });

  it('skips a sibling row with no personality id, since from_id could not resolve it', () => {
    const result = extractCharacterParticipants(
      [entry({ personalityName: 'Kai' }), entry({ personalityId: '', personalityName: 'Rin' })],
      'Lilith'
    );

    expect(result).toEqual([]);
  });

  it('dedups repeated lines from the same character', () => {
    const result = extractCharacterParticipants(
      [
        entry({ personalityId: 'p-kai', personalityName: 'Kai' }),
        entry({ personalityId: 'p-kai', personalityName: 'Kai' }),
      ],
      'Lilith'
    );

    expect(result).toHaveLength(1);
  });

  it('shows a renamed sibling under its NEWEST name, not the oldest in the window', () => {
    // The walk is newest-first, so an unconditional map write would let the
    // OLDEST occurrence win the name — inverting the recency this function
    // selects by. The dedup test above cannot catch this: it uses one name for
    // every occurrence, so both orderings look identical.
    const result = extractCharacterParticipants(
      [
        entry({ personalityId: 'p-kai', personalityName: 'OldName' }),
        entry({ personalityId: 'p-kai', personalityName: 'NewName' }),
      ],
      'Lilith'
    );

    expect(result).toEqual([{ personalityId: 'p-kai', personalityName: 'NewName' }]);
  });

  it('orders by personality id so the cached roster does not reshuffle with recency', () => {
    const recent = [
      entry({ personalityId: 'p-zed', personalityName: 'Zed' }),
      entry({ personalityId: 'p-ada', personalityName: 'Ada' }),
    ];
    const reversed = [...recent].reverse();

    expect(extractCharacterParticipants(recent, 'Lilith')).toEqual(
      extractCharacterParticipants(reversed, 'Lilith')
    );
    expect(extractCharacterParticipants(recent, 'Lilith').map(c => c.personalityId)).toEqual([
      'p-ada',
      'p-zed',
    ]);
  });

  it('recognises the responder by id even after a rename breaks the name match', () => {
    // personalityName is stamped at write time. Before the id comparison, a
    // rename past the old name's prefix made these rows read as a sibling —
    // so the personality got a roster entry pointing at itself.
    const result = extractCharacterParticipants(
      [entry({ personalityId: 'p-self', personalityName: 'OldName' })],
      'CompletelyNewName',
      'p-self'
    );

    expect(result).toEqual([]);
  });

  it('treats a different id as a sibling even when the names would collide', () => {
    // The mirror: name-prefix collision used to swallow a real sibling. With
    // both ids present the name is not consulted at all.
    const result = extractCharacterParticipants(
      [entry({ personalityId: 'p-alex', personalityName: 'Alex' })],
      'Alexandra',
      'p-alexandra'
    );

    expect(result).toEqual([{ personalityId: 'p-alex', personalityName: 'Alex' }]);
  });

  it('drops a sibling the prefix self-match heuristic mistakes for the responder', () => {
    // resolveSpeakerInfo's self-match is bidirectional-prefix, an accepted edge
    // that used to cost only a mislabeled chat-log role. Reusing it as the
    // roster membership test widens that: the mislabeled sibling is now also
    // absent from <participants>, so its lines have nothing to bind to. Pinned
    // as KNOWN behaviour rather than asserted as correct — if the heuristic is
    // ever tightened, this test should be updated, not deleted around.
    // No responder id supplied, so the name heuristic is still the decider —
    // which is exactly the id-less-row fallback that survives the id fix.
    const result = extractCharacterParticipants(
      [entry({ personalityId: 'p-alex', personalityName: 'Alex' })],
      'Alexandra'
    );

    expect(result).toEqual([]);
  });

  it('caps the roster and keeps the most recently active siblings', () => {
    // 12 distinct siblings, oldest first. The cap is 10, so the two OLDEST
    // must be the ones dropped — selection is recency, not first-seen.
    const history = Array.from({ length: 12 }, (_, i) =>
      entry({ personalityId: `p-${String(i).padStart(2, '0')}`, personalityName: `C${i}` })
    );

    const result = extractCharacterParticipants(history, 'Lilith');
    const ids = result.map(c => c.personalityId);

    expect(ids).toHaveLength(MESSAGE_LIMITS.MAX_ROSTER_CHARACTERS);
    expect(ids).not.toContain('p-00');
    expect(ids).not.toContain('p-01');
    expect(ids).toContain('p-11');
  });

  it('does not spend cap slots on repeats of a sibling already collected', () => {
    // A chatty sibling filling the window must not crowd out the others: the
    // cap counts DISTINCT characters, which a naive per-row counter would get
    // wrong.
    const history = [
      entry({ personalityId: 'p-old', personalityName: 'Old' }),
      ...Array.from({ length: 30 }, () =>
        entry({ personalityId: 'p-chatty', personalityName: 'Chatty' })
      ),
    ];

    const ids = extractCharacterParticipants(history, 'Lilith').map(c => c.personalityId);

    expect(ids).toContain('p-old');
    expect(ids).toContain('p-chatty');
  });

  it('returns an empty list for absent history', () => {
    expect(extractCharacterParticipants(undefined, 'Lilith')).toEqual([]);
  });
});
