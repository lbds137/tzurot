import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';

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

import { resolveSpeakerInfo, extractParticipants } from './participantUtils.js';
import type { RawHistoryEntry } from './conversationTypes.js';

describe('resolveSpeakerInfo', () => {
  const msg = (overrides: Partial<RawHistoryEntry>): RawHistoryEntry =>
    ({ role: 'user', content: 'hi', ...overrides }) as RawHistoryEntry;

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
