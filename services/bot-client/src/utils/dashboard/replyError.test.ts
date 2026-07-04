import { describe, it, expect, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { replyError } from './replyError.js';

const warnMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnMock, error: vi.fn() }),
  };
});

type AckState = { deferred: boolean; replied: boolean };

function makeInteraction(state: AckState): {
  interaction: ButtonInteraction | StringSelectMenuInteraction;
  editReply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
} {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const followUp = vi.fn().mockResolvedValue(undefined);
  const reply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    deferred: state.deferred,
    replied: state.replied,
    editReply,
    followUp,
    reply,
  } as unknown as ButtonInteraction | StringSelectMenuInteraction;
  return { interaction, editReply, followUp, reply };
}

describe('replyError', () => {
  it('deferred & not replied → editReply (fills the deferred slot, inherits its flags)', async () => {
    const { interaction, editReply, followUp, reply } = makeInteraction({
      deferred: true,
      replied: false,
    });

    await replyError(interaction, 'boom');

    // No explicit flags: the deferred slot's ephemeral flag is what keeps it private.
    expect(editReply).toHaveBeenCalledWith({ content: 'boom' });
    expect(followUp).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('replied → followUp with explicit ephemeral flag', async () => {
    const { interaction, editReply, followUp, reply } = makeInteraction({
      deferred: false,
      replied: true,
    });

    await replyError(interaction, 'boom');

    expect(followUp).toHaveBeenCalledWith({ content: 'boom', flags: MessageFlags.Ephemeral });
    expect(editReply).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it('fresh (neither deferred nor replied) → reply with explicit ephemeral flag', async () => {
    const { interaction, editReply, followUp, reply } = makeInteraction({
      deferred: false,
      replied: false,
    });

    await replyError(interaction, 'boom');

    expect(reply).toHaveBeenCalledWith({ content: 'boom', flags: MessageFlags.Ephemeral });
    expect(editReply).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it('replied takes precedence when both deferred and replied are true', async () => {
    // A deferred interaction that has since sent its real reply: the `replied`
    // branch must win so we followUp rather than overwrite the sent message.
    const { interaction, editReply, followUp } = makeInteraction({
      deferred: true,
      replied: true,
    });

    await replyError(interaction, 'boom');

    expect(followUp).toHaveBeenCalledWith({ content: 'boom', flags: MessageFlags.Ephemeral });
    expect(editReply).not.toHaveBeenCalled();
  });

  it('accepts a ModalSubmitInteraction (widened signature) — deferred → editReply', async () => {
    // Modal submits share the deferred/replied/reply/editReply/followUp surface,
    // so the same ack-adaptive logic applies. This pins the type-level acceptance.
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      deferred: true,
      replied: false,
      editReply,
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ModalSubmitInteraction;

    await replyError(interaction, 'boom');

    expect(editReply).toHaveBeenCalledWith({ content: 'boom' });
  });

  it('warns when the deferred path runs on a non-ephemeral interaction (privacy footgun)', async () => {
    warnMock.mockClear();
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      deferred: true,
      replied: false,
      ephemeral: false, // caller deferred WITHOUT MessageFlags.Ephemeral
      id: '123456789',
      editReply,
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await replyError(interaction, 'boom');

    // It still fills the deferred slot (can't un-defer), but flags the misuse.
    expect(editReply).toHaveBeenCalledWith({ content: 'boom' });
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT warn on the deferred path when the interaction is ephemeral', async () => {
    warnMock.mockClear();
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      deferred: true,
      replied: false,
      ephemeral: true,
      id: '123456789',
      editReply,
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ButtonInteraction;

    await replyError(interaction, 'boom');

    expect(editReply).toHaveBeenCalledWith({ content: 'boom' });
    expect(warnMock).not.toHaveBeenCalled();
  });
});
