import { describe, it, expect, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { ackMethodFor, replySpec, replySpecSafe, type RepliableInteraction } from './reply.js';
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
} {
  return {
    ...state,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
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

describe('replySpecSafe', () => {
  it('swallows delivery failures (the caller is already on an error path)', async () => {
    const interaction = mockInteraction({ deferred: false, replied: false });
    interaction.reply.mockRejectedValue(new Error('Unknown interaction'));

    await expect(replySpecSafe(interaction, CATALOG.error.commandFailed())).resolves.not.toThrow();
  });
});
