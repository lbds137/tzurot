import { describe, it, expect, vi } from 'vitest';
import { resolveIncognito } from './incognitoMode.js';

type Ctx = Parameters<typeof resolveIncognito>[0];

/** A context carrying only the fields the resolution reads. */
function ctx(kind: 'personal' | 'incognito', reroll?: Ctx['reroll']): Ctx {
  return { userId: 'u1', summonAnonymity: { kind }, reroll } as unknown as Ctx;
}
const personal = ctx('personal');
const anonymous = ctx('incognito');

describe('resolveIncognito', () => {
  it('is not incognito with no summon, no skip and no session', async () => {
    expect(await resolveIncognito(personal, async () => false)).toEqual({
      active: false,
      summon: false,
      kind: undefined,
    });
  });

  it('is a session when the requester session is live', async () => {
    expect(await resolveIncognito(personal, async () => true)).toEqual({
      active: true,
      summon: false,
      kind: 'session',
    });
  });

  it('is a session for a reroll that carries skipMemoryWrite, without asking Redis', async () => {
    const isSessionActive = vi.fn(async () => false);

    const result = await resolveIncognito(
      ctx('personal', { rowId: 'r', attemptId: 'a', skipMemoryWrite: true }),
      isSessionActive
    );

    expect(result).toEqual({ active: true, summon: false, kind: 'session' });
    expect(isSessionActive).not.toHaveBeenCalled();
  });

  it('is a summon, outranking a live session, without asking Redis', async () => {
    const isSessionActive = vi.fn(async () => true);

    expect(await resolveIncognito(anonymous, isSessionActive)).toEqual({
      active: true,
      summon: true,
      kind: 'summon',
    });
    expect(isSessionActive).not.toHaveBeenCalled();
  });
});
