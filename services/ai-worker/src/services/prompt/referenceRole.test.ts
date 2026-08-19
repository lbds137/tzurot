import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UNKNOWN_USER_NAME } from '@tzurot/common-types/constants/message';
import { deriveRefRole } from './referenceRole.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

describe('deriveRefRole name matching (fallback path)', () => {
  it('matches when the author name is prefixed by the active personality name', () => {
    // Webhook usernames are `${displayName}${botSuffix}`, so the personality name is a prefix.
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'Lilith ▽', personalityName: 'Lilith' })
    ).toBe('assistant');
  });

  it('is case-insensitive', () => {
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'lilith ▽', personalityName: 'Lilith' })
    ).toBe('assistant');
  });

  it('does not match an unrelated author', () => {
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'Some Human', personalityName: 'Lilith' })
    ).toBe('user');
  });

  it('resolves a non-persona author to user even with a personality set', () => {
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: 'Some Human',
        personalityName: 'Lilith',
        allPersonalityNames: new Set(['Lila', 'Lilith']),
      })
    ).toBe('user');
  });
});

describe('deriveRefRole', () => {
  it('resolves a stamped assistant to assistant when the author is the responding persona', () => {
    // The stamp says "one of our personas" — the render-time split decides WHICH.
    expect(
      deriveRefRole({ authorRole: 'assistant', authorName: 'Lilith ▽', personalityName: 'Lilith' })
    ).toBe('assistant');
  });

  it('demotes a stamped assistant to character on a positive sibling match', () => {
    // A sibling's line must never render as the responding persona's own words.
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Ha-Shem ▽',
        personalityName: 'Yeshua',
        allPersonalityNames: new Set(['Ha-Shem', 'Yeshua']),
      })
    ).toBe('character');
  });

  it('keeps a stamped assistant WITHOUT a positive sibling match (conservative default)', () => {
    // Name vocabularies differ across call sites (stored name vs displayName), so
    // an unmatched author keeps assistant rather than misfiring on the persona's
    // own line — demotion requires positive evidence.
    expect(
      deriveRefRole({ authorRole: 'assistant', authorName: 'Ha-Shem ▽', personalityName: 'Yeshua' })
    ).toBe('assistant');
  });

  it("does not demote the persona's own line when the set carries its stored-name variant", () => {
    // Stored rows carry personality.name ("Yeshua") while the live path matches
    // displayName ("Yeshua ben Yosef") — the name-variant entry must read as SELF.
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Yeshua ▽',
        personalityName: 'Yeshua ben Yosef',
        allPersonalityNames: new Set(['Yeshua', 'Ha-Shem', 'Yeshua ben Yosef']),
      })
    ).toBe('assistant');
  });

  it('fallback: own line under a stored-name variant resolves to assistant, not character', () => {
    // Mirror of the stamped self-variant pin with NO stamp — the fallback must
    // route through the same self-variant guard. Matching the bare set entry
    // instead misreads the persona's own line as a character line.
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: 'Yeshua ▽',
        personalityName: 'Yeshua ben Yosef',
        allPersonalityNames: new Set(['Yeshua', 'Ha-Shem', 'Yeshua ben Yosef']),
      })
    ).toBe('assistant');
  });

  it('returns the stamped authorRole verbatim when present (user)', () => {
    expect(
      deriveRefRole({ authorRole: 'user', authorName: 'Lilith', personalityName: 'Lilith' })
    ).toBe('user');
  });

  it('returns the stamped authorRole verbatim when present (bot)', () => {
    // Even though name-matching has no `bot` concept, an explicit bot role is honored.
    expect(
      deriveRefRole({ authorRole: 'bot', authorName: 'Some Bot', personalityName: 'Lilith' })
    ).toBe('bot');
  });

  it('falls back to assistant when authorRole is absent and the name matches the personality', () => {
    // The deployment-transition / pre-classifier case: a reference produced before
    // authorRole is stamped (old bot-client mid-rolling-deploy, or pre-classifier
    // stored history) still resolves the personality's own message to assistant.
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'Lilith ▽', personalityName: 'Lilith' })
    ).toBe('assistant');
  });

  it('falls back to character for a sibling persona when allPersonalityNames is provided', () => {
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: 'Lila ▽',
        personalityName: 'Lilith',
        allPersonalityNames: new Set(['Lila', 'Lilith']),
      })
    ).toBe('character');
  });

  it('falls back to user when authorRole is absent and the name does not match', () => {
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'Some Human', personalityName: 'Lilith' })
    ).toBe('user');
  });

  it('falls back to user for a sibling persona when allPersonalityNames is omitted', () => {
    // Documented degraded behavior: without the full personality set, only the active
    // personality's own messages resolve to assistant in the fallback window.
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'Lila ▽', personalityName: 'Lilith' })
    ).toBe('user');
  });

  it('falls back to user for a third-party bot, which the instruction calls a person', () => {
    // Accepted transition-window degradation, NOT a missed case. Without a stamp
    // there is no bot-authorship signal, so third-party automation is
    // indistinguishable from a human here and reads as "user". Only reachable
    // when an old bot-client produced the reference mid-rolling-deploy — the
    // stamped path renders role="bot" (see ReferencedMessageFormatter's
    // non-persona-automation case).
    expect(
      deriveRefRole({ authorRole: undefined, authorName: 'MEE6', personalityName: 'Lilith' })
    ).toBe('user');
  });

  it('resolves an identity-stripped forwarded reference to user, never assistant', () => {
    // Discord strips author identity from message snapshots, so SnapshotFormatter
    // stamps UNKNOWN_USER_NAME rather than a real display name. That is what bounds
    // the name-collision edge: a forwarded reference carries no author name to
    // collide with a personality's, so it cannot be promoted to assistant no matter
    // how long it lives. Pinning it here keeps that reasoning honest if the
    // placeholder ever changes to something a personality name could prefix.
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: UNKNOWN_USER_NAME,
        personalityName: 'Lilith',
      })
    ).toBe('user');
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: UNKNOWN_USER_NAME,
        personalityName: 'Lilith',
        allPersonalityNames: new Set(['Lilith', 'Lila']),
      })
    ).toBe('user');
  });
});

describe('name-match fallback tripwire', () => {
  beforeEach(() => {
    mockLogger.info.mockClear();
  });

  it('fires when the fallback promotes to assistant on a direct self-match', () => {
    deriveRefRole({ authorRole: undefined, authorName: 'Lilith ▽', personalityName: 'Lilith' });

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { personalityName: 'Lilith', via: 'self' },
      expect.stringContaining('name-match fallback')
    );
  });

  it('distinguishes the self-variant arm, which matches under a different name vocabulary', () => {
    // Stored rows carry `personality.name` while the live path passes displayName,
    // so the two arms fire in different deployments — telling them apart is what
    // makes the volume signal diagnosable rather than just a number.
    // Same fixture as the self-variant behavioural pin above: the author matches
    // the STORED name while the responder is identified by displayName, so the
    // direct prefix check misses and only the self-variant guard resolves it.
    deriveRefRole({
      authorRole: undefined,
      authorName: 'Yeshua ▽',
      personalityName: 'Yeshua ben Yosef',
      allPersonalityNames: new Set(['Yeshua', 'Ha-Shem', 'Yeshua ben Yosef']),
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'self-variant' }),
      expect.any(String)
    );
  });

  it('never logs the author name — a Discord display name is username-class PII', () => {
    // The collision this tripwire watches for is precisely a HUMAN whose name
    // prefixes a personality's, so the tempting field to add is the one that must
    // never be added. Pinned so a future "make it more diagnosable" edit fails here
    // instead of in prod logs.
    deriveRefRole({ authorRole: undefined, authorName: 'Lilith Smith', personalityName: 'Lilith' });

    const [payload] = mockLogger.info.mock.calls[0];
    expect(JSON.stringify(payload)).not.toContain('Lilith Smith');
  });

  it('stays silent when a stamp is present — this is the fallback path only', () => {
    deriveRefRole({ authorRole: 'assistant', authorName: 'Lilith ▽', personalityName: 'Lilith' });
    deriveRefRole({ authorRole: 'user', authorName: 'Some Human', personalityName: 'Lilith' });
    deriveRefRole({ authorRole: 'bot', authorName: 'MEE6', personalityName: 'Lilith' });

    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('stays silent when the fallback does NOT promote to assistant', () => {
    deriveRefRole({ authorRole: undefined, authorName: 'Some Human', personalityName: 'Lilith' });
    deriveRefRole({
      authorRole: undefined,
      authorName: 'Lila ▽',
      personalityName: 'Lilith',
      allPersonalityNames: new Set(['Lila', 'Lilith']),
    });

    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});

describe('personality-id decision (exact, rename-immune)', () => {
  const SELF = '11111111-2222-4333-8444-555555555555';
  const SIBLING = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('reads the responder own quoted line as assistant when the ids match', () => {
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Lilith ▽',
        personalityName: 'Lilith',
        authorPersonalityId: SELF,
        responderPersonalityId: SELF,
      })
    ).toBe('assistant');
  });

  it('reads a sibling quoted line as character when the ids differ', () => {
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Lilith ▽',
        personalityName: 'Lilith',
        authorPersonalityId: SIBLING,
        responderPersonalityId: SELF,
      })
    ).toBe('character');
  });

  it('survives a rename the name comparison gets wrong', () => {
    // The quoted line was written under the OLD name, so the prefix match
    // reads it as a sibling. The id says it is the responder's own line.
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Lilith ▽',
        personalityName: 'Lily',
        allPersonalityNames: new Set(['Lilith', 'Lily']),
        authorPersonalityId: SELF,
        responderPersonalityId: SELF,
      })
    ).toBe('assistant');
  });

  it('separates same-named siblings the prefix match swallows as self', () => {
    // Identical names, different personalities — indistinguishable by name
    // (Personality.name carries no unique constraint; only slug does).
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Lilith ▽',
        personalityName: 'Lilith',
        allPersonalityNames: new Set(['Lilith']),
        authorPersonalityId: SIBLING,
        responderPersonalityId: SELF,
      })
    ).toBe('character');
  });

  it('decides even with no stamp — an id is proof our bot authored it', () => {
    expect(
      deriveRefRole({
        authorRole: undefined,
        authorName: 'Some Human',
        personalityName: 'Lilith',
        authorPersonalityId: SIBLING,
        responderPersonalityId: SELF,
      })
    ).toBe('character');
  });

  it('lets an authoritative user or bot stamp block the id shortcut', () => {
    const base = {
      authorName: 'Lilith ▽',
      personalityName: 'Lilith',
      authorPersonalityId: SIBLING,
      responderPersonalityId: SELF,
    };
    expect(deriveRefRole({ ...base, authorRole: 'user' })).toBe('user');
    expect(deriveRefRole({ ...base, authorRole: 'bot' })).toBe('bot');
  });

  it('falls back to the name comparison when either id is missing', () => {
    // Sibling by name, no responder id → the pre-existing name path decides.
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Ha-Shem ▽',
        personalityName: 'Yeshua',
        allPersonalityNames: new Set(['Ha-Shem', 'Yeshua']),
        authorPersonalityId: SIBLING,
      })
    ).toBe('character');
    // Self by name, no author id → likewise.
    expect(
      deriveRefRole({
        authorRole: 'assistant',
        authorName: 'Lilith ▽',
        personalityName: 'Lilith',
        responderPersonalityId: SELF,
      })
    ).toBe('assistant');
  });
});
