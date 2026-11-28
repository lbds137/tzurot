import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationCommandType, type MessageContextMenuCommandInteraction } from 'discord.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { REROLL_MEMORY_LOCKED_MESSAGE } from '../utils/editResponse/rerollPreflight.js';
import rerollMessageCommand from './rerollMessage.js';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  resolveMessageCharacterOrReply: vi.fn(),
  acquireRerollGuard: vi.fn(),
  releaseRerollGuard: vi.fn(),
  submitRerollTurn: vi.fn(),
  loadPersonalityStrict: vi.fn(),
  replySpec: vi.fn(),
  replySpecSafe: vi.fn(),
}));

vi.mock('../redis.js', () => ({ redis: { tag: 'redis' } }));
vi.mock('../utils/messageCharacterLookup.js', () => ({
  resolveMessageCharacterOrReply: mocks.resolveMessageCharacterOrReply,
}));
vi.mock('../utils/gatewayClients.js', () => ({
  clientsFor: () => ({ userClient: { checkRerollAssistantMessage: mocks.check } }),
}));
vi.mock('../services/character/rerollGuard.js', () => ({
  acquireRerollGuard: mocks.acquireRerollGuard,
  releaseRerollGuard: mocks.releaseRerollGuard,
}));
vi.mock('../services/character/rerollTurn.js', () => ({
  submitRerollTurn: mocks.submitRerollTurn,
}));
vi.mock('../services/serviceRegistry.js', () => ({
  getPersonalityLoader: () => ({ loadPersonalityStrict: mocks.loadPersonalityStrict }),
}));
vi.mock('../ux/render/reply.js', () => ({
  replySpec: mocks.replySpec,
  replySpecSafe: mocks.replySpecSafe,
}));

const preflight = {
  rowId: 'row-1',
  personalityId: 'pers-1',
  personaId: 'persona-1',
  ownerDiscordId: 'owner',
  incognito: false,
  content: 'old',
  discordMessageIds: ['222222222222222222'],
  trigger: null,
  memoryPlan: { kind: 'none' },
};

function makeInteraction(): MessageContextMenuCommandInteraction {
  return {
    targetMessage: { id: '222222222222222222' },
    user: { id: 'clicker' },
  } as unknown as MessageContextMenuCommandInteraction;
}

const lastReply = (): string => JSON.stringify(mocks.replySpec.mock.calls.at(-1)?.[1]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveMessageCharacterOrReply.mockResolvedValue({
    personalitySlug: 'lila',
    incognito: false,
  });
  mocks.check.mockResolvedValue({ ok: true, data: preflight });
  mocks.acquireRerollGuard.mockResolvedValue(true);
  mocks.loadPersonalityStrict.mockResolvedValue({ id: 'pers-1' });
  mocks.submitRerollTurn.mockResolvedValue({ kind: 'submitted', attemptId: 'x' });
});

describe('Reroll context-menu command', () => {
  it('declares a MESSAGE-type context-menu command named "Reroll"', () => {
    const json = rerollMessageCommand.data.toJSON();
    expect(json.name).toBe('Reroll');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('submits the turn and keeps the guard for the result handler', async () => {
    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.submitRerollTurn).toHaveBeenCalledWith(
      expect.objectContaining({ preflight, personality: { id: 'pers-1' } })
    );
    expect(mocks.acquireRerollGuard).toHaveBeenCalledWith(
      { tag: 'redis' },
      'row-1',
      expect.any(String)
    );
    expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
  });

  it('stops silently when the character lookup already replied', async () => {
    mocks.resolveMessageCharacterOrReply.mockResolvedValue(null);

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('refuses a double click while the guard is held, without generating', async () => {
    mocks.acquireRerollGuard.mockResolvedValue(false);

    await rerollMessageCommand.execute(makeInteraction());

    expect(lastReply()).toContain('already being rerolled');
    expect(mocks.submitRerollTurn).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).not.toHaveBeenCalled();
  });

  it('tells a non-owner this is not their reply on a 404', async () => {
    mocks.check.mockResolvedValue({ ok: false, status: 404, error: 'x', kind: 'http' });

    await rerollMessageCommand.execute(makeInteraction());

    expect(lastReply()).toContain("isn't one of your character replies");
    expect(mocks.acquireRerollGuard).not.toHaveBeenCalled();
  });

  it('refuses a reply that is no longer the latest', async () => {
    mocks.check.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'x',
      kind: 'http',
      code: API_ERROR_SUBCODE.NOT_LATEST,
    });

    await rerollMessageCommand.execute(makeInteraction());

    expect(lastReply()).toContain('latest reply');
    expect(mocks.submitRerollTurn).not.toHaveBeenCalled();
  });

  it('refuses a locked memory with the unlock hint and releases the guard', async () => {
    mocks.check.mockResolvedValue({
      ok: true,
      data: { ...preflight, memoryPlan: { kind: 'blocked', reason: 'locked' } },
    });

    await rerollMessageCommand.execute(makeInteraction());

    expect(lastReply()).toContain(REROLL_MEMORY_LOCKED_MESSAGE);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledWith(
      { tag: 'redis' },
      'row-1',
      expect.any(String)
    );
    expect(mocks.submitRerollTurn).not.toHaveBeenCalled();
  });

  it('releases the guard and replies when the turn refuses', async () => {
    mocks.submitRerollTurn.mockResolvedValue({ kind: 'refused', message: 'persona changed' });

    await rerollMessageCommand.execute(makeInteraction());

    expect(lastReply()).toContain('persona changed');
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('releases the guard without a reply when a gate already replied', async () => {
    mocks.submitRerollTurn.mockResolvedValue({ kind: 'refused', message: null });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.replySpec).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('releases the guard and replies when submitting throws', async () => {
    mocks.submitRerollTurn.mockRejectedValue(new Error('boom'));

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.replySpecSafe).toHaveBeenCalledTimes(1);
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });
});

describe('Reroll context-menu command: incognito and re-check', () => {
  it('passes the effective incognito, merging the legacy-row inference with the stored flag', async () => {
    mocks.resolveMessageCharacterOrReply.mockResolvedValue({
      personalitySlug: 'lila',
      incognito: true,
    });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.submitRerollTurn).toHaveBeenCalledWith(
      expect.objectContaining({ incognito: true })
    );
  });

  it('stays incognito when only the stored flag says so', async () => {
    mocks.check.mockResolvedValue({ ok: true, data: { ...preflight, incognito: true } });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.submitRerollTurn).toHaveBeenCalledWith(
      expect.objectContaining({ incognito: true })
    );
  });

  it('re-checks after taking the guard and refuses when the latest reply moved on', async () => {
    mocks.check.mockResolvedValueOnce({ ok: true, data: preflight }).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: 'x',
      kind: 'http',
      code: API_ERROR_SUBCODE.NOT_LATEST,
    });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.check).toHaveBeenCalledTimes(2);
    expect(lastReply()).toContain('latest reply');
    expect(mocks.submitRerollTurn).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('refuses when the re-check returns a different row than the one guarded', async () => {
    mocks.check
      .mockResolvedValueOnce({ ok: true, data: preflight })
      .mockResolvedValueOnce({ ok: true, data: { ...preflight, rowId: 'row-2' } });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.submitRerollTurn).not.toHaveBeenCalled();
    expect(mocks.releaseRerollGuard).toHaveBeenCalledTimes(1);
  });

  it('submits the re-checked preflight, not the stale one', async () => {
    const fresh = { ...preflight, content: 'fresher' };
    mocks.check
      .mockResolvedValueOnce({ ok: true, data: preflight })
      .mockResolvedValueOnce({ ok: true, data: fresh });

    await rerollMessageCommand.execute(makeInteraction());

    expect(mocks.submitRerollTurn).toHaveBeenCalledWith(
      expect.objectContaining({ preflight: fresh })
    );
  });
});
