import { describe, it, expect, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  ackMethodFor,
  ackUpdate,
  ackDeferReply,
  deferKindOf,
  followUpSpec,
  replySpec,
  replySpecSafe,
  type RepliableInteraction,
  type DeferUpdatableInteraction,
} from './reply.js';
import { CATALOG } from '../catalog/catalog.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function mockInteraction(state: { deferred: boolean; replied: boolean }): RepliableInteraction & {
  reply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deferUpdate: ReturnType<typeof vi.fn>;
  deferReply: ReturnType<typeof vi.fn>;
} {
  return {
    ...state,
    id: 'interaction-1',
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
  } as never;
}

describe('ackMethodFor (the pure ack matrix)', () => {
  // Council-mandated matrix — the deferred && !replied → editReply row is the
  // latent-bug fix over the old sendErrorReply (which followUp'd, stranding
  // the "Thinking…" placeholder).
  it.each([
    [{ deferred: true, replied: false }, 'editReply'],
    [{ deferred: true, replied: true }, 'followUp'],
    [{ deferred: false, replied: true }, 'followUp'],
    [{ deferred: false, replied: false }, 'reply'],
  ] as const)('%o → %s', (state, expected) => {
    expect(ackMethodFor(state)).toBe(expected);
  });

  // deferKind splits the deferred && !replied row: a deferUpdate left the
  // component message in place (followUp), a deferReply left a placeholder
  // (editReply). Unstamped keeps the historical editReply behavior.
  it.each([
    [{ deferred: true, replied: false, deferKind: 'update' }, 'followUp'],
    [{ deferred: true, replied: false, deferKind: 'reply' }, 'editReply'],
    [{ deferred: true, replied: false }, 'editReply'], // unstamped
    [{ deferred: true, replied: true, deferKind: 'update' }, 'followUp'], // replied wins
  ] as const)('%o → %s', (state, expected) => {
    expect(ackMethodFor(state)).toBe(expected);
  });
});

describe('ack wrappers stamp the defer kind', () => {
  it('ackUpdate defers-update, records "update", and makes replySpec follow up (no clobber)', async () => {
    const interaction = mockInteraction({ deferred: true, replied: false });

    await ackUpdate(interaction as unknown as DeferUpdatableInteraction);

    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
    expect(deferKindOf(interaction)).toBe('update');

    // The core payoff: replySpec on a deferUpdate'd interaction follows up
    // ephemerally instead of clobbering the component message via editReply.
    await replySpec(interaction, CATALOG.error.notFound('Character'));
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: '❌ Character not found.',
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('ackDeferReply records "reply" and keeps replySpec on editReply (fills the placeholder)', async () => {
    const interaction = mockInteraction({ deferred: true, replied: false });

    await ackDeferReply(interaction, { ephemeral: true });

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(deferKindOf(interaction)).toBe('reply');

    await replySpec(interaction, CATALOG.error.notFound('Character'));
    expect(interaction.editReply).toHaveBeenCalledWith({ content: '❌ Character not found.' });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});

describe('replySpec', () => {
  it('fills the deferral placeholder via editReply (the fixed branch)', async () => {
    const interaction = mockInteraction({ deferred: true, replied: false });
    await replySpec(interaction, CATALOG.error.commandFailed());

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ There was an error executing this command!',
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('follows up ephemerally when already replied', async () => {
    const interaction = mockInteraction({ deferred: false, replied: true });
    await replySpec(interaction, CATALOG.error.interactionFailed());

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: '❌ There was an error processing this interaction!',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('replies ephemerally on a fresh interaction', async () => {
    const interaction = mockInteraction({ deferred: false, replied: false });
    await replySpec(interaction, CATALOG.progress.sessionExpired());

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '⏰ Session expired. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('threads render options (register selection) through', async () => {
    const interaction = mockInteraction({ deferred: false, replied: false });
    await replySpec(
      interaction,
      { severity: 'warning', outcome: 'failed', text: 'sys', personaText: 'persona' },
      { register: 'persona' }
    );

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ persona' })
    );
  });
});

describe('followUpSpec', () => {
  it('always follows up ephemerally, regardless of ack state (the deferUpdate escape hatch)', async () => {
    // A deferUpdate'd component handler must NOT take the ack matrix's
    // editReply branch (it would clobber the component message) — this helper
    // bypasses the matrix entirely.
    const interaction = mockInteraction({ deferred: true, replied: false });
    await followUpSpec(interaction, CATALOG.error.notFound('Memory'));

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: '❌ Memory not found.',
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('threads render options through', async () => {
    const interaction = mockInteraction({ deferred: false, replied: false });
    await followUpSpec(
      interaction,
      { severity: 'warning', outcome: 'failed', text: 'sys', personaText: 'persona' },
      { register: 'persona' }
    );
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ persona' })
    );
  });
});

describe('replySpecSafe', () => {
  it('swallows delivery failures (the caller is already on an error path)', async () => {
    const interaction = mockInteraction({ deferred: false, replied: false });
    interaction.reply.mockRejectedValue(new Error('Unknown interaction'));

    await expect(replySpecSafe(interaction, CATALOG.error.commandFailed())).resolves.not.toThrow();
  });
});
