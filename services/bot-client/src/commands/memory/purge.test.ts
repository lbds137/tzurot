/**
 * Tests for Memory Purge Handler
 *
 * Three entry points, each routed through CommandHandler:
 * - handlePurge: slash command renders the warning embed + buttons, returns.
 * - handlePurgeButton: proceed → showModal, cancel → update.
 * - handlePurgeModal: validates phrase, performs purge.
 *
 * The handler MUST NOT use `awaitMessageComponent` / `awaitModalSubmit` —
 * those race with CommandHandler and produce 10062 "Unknown interaction"
 * errors at random under load. See `.claude/rules/04-discord.md`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePurge, handlePurgeButton, handlePurgeModal, MEMORY_PURGE_PREFIX } from './purge.js';
import type { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../utils/userGatewayClient.js')>(
    '../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

vi.mock('../../utils/commandHelpers.js', () => ({
  createDangerEmbed: vi.fn((_title: string, _description: string) => {
    const embed = {
      setFooter: vi.fn().mockReturnThis(),
      toJSON: () => ({ title: 'Test Danger' }),
    };
    return embed;
  }),
  createSuccessEmbed: vi.fn((_title: string, _description: string) => ({
    toJSON: () => ({ title: 'Test Success' }),
  })),
}));

const mockResolvePersonalityId = vi.fn();
vi.mock('./autocomplete.js', () => ({
  resolvePersonalityId: (...args: unknown[]) => mockResolvePersonalityId(...args),
}));

const PERSONALITY_ID = 'personality-uuid-123';
const PERSONALITY_NAME = 'Lilith';
const EXPECTED_PHRASE = 'DELETE LILITH MEMORIES';

function createMockContext(personality = 'lilith') {
  return {
    user: { id: 'user-123', username: 'testuser', globalName: 'testuser' },
    interaction: {
      options: {
        getString: (name: string, _required?: boolean) =>
          name === 'character' ? personality : null,
      },
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof handlePurge>[0] & { editReply: ReturnType<typeof vi.fn> };
}

/** Build a ButtonInteraction with the parent message's embed footer carrying the personality name. */
function createMockButtonInteraction(
  customId: string,
  opts: { footerText?: string | null; userId?: string } = {}
) {
  // Use `in` check so explicit `null` overrides the default — `??` would replace null with the default.
  const footerText: string | null =
    'footerText' in opts && opts.footerText !== undefined
      ? opts.footerText
      : `Personality: ${PERSONALITY_NAME}`;
  return {
    customId,
    user: { id: opts.userId ?? 'user-123' },
    message: {
      embeds: [
        {
          footer: footerText === null ? null : { text: footerText },
        },
      ],
    },
    update: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction & {
    update: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    showModal: ReturnType<typeof vi.fn>;
  };
}

/** Build a ModalSubmitInteraction with parent-message embed footer. */
function createMockModalInteraction(
  phrase: string,
  opts: { customId?: string; footerText?: string | null; userId?: string } = {}
) {
  const customId =
    opts.customId ??
    `${MEMORY_PURGE_PREFIX}::confirm::${PERSONALITY_ID}::${opts.userId ?? 'user-123'}`;
  // Use `in` check so explicit `null` overrides the default — `??` would replace null with the default.
  const footerText: string | null =
    'footerText' in opts && opts.footerText !== undefined
      ? opts.footerText
      : `Personality: ${PERSONALITY_NAME}`;
  const messageEdit = vi.fn().mockResolvedValue(undefined);
  return {
    customId,
    user: { id: opts.userId ?? 'user-123' },
    fields: {
      getTextInputValue: vi.fn((_fieldId: string) => phrase),
    },
    message:
      footerText === null
        ? null
        : {
            embeds: [{ footer: { text: footerText } }],
            edit: messageEdit,
          },
    isFromMessage: vi.fn(() => footerText !== null),
    update: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    _messageEdit: messageEdit,
  } as unknown as ModalSubmitInteraction & {
    update: ReturnType<typeof vi.fn>;
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    _messageEdit: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handlePurge (slash command entry)', () => {
  it('shows error when personality not found', async () => {
    mockResolvePersonalityId.mockResolvedValue(null);
    const context = createMockContext('unknown-personality');

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
  });

  it('shows error when stats API fails', async () => {
    mockResolvePersonalityId.mockResolvedValue(PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 500, error: 'Server error' });
    const context = createMockContext();

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed'),
    });
  });

  it('shows 404 message when personality not in stats', async () => {
    mockResolvePersonalityId.mockResolvedValue(PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({ ok: false, status: 404, error: 'Not found' });
    const context = createMockContext();

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('not found'),
    });
  });

  it('shows "no memories" message when nothing to purge', async () => {
    mockResolvePersonalityId.mockResolvedValue(PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalityId: PERSONALITY_ID,
        personalityName: PERSONALITY_NAME,
        personaId: 'persona-123',
        totalCount: 0,
        lockedCount: 0,
      },
    });
    const context = createMockContext();

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No memories found'),
    });
  });

  it('renders warning embed + buttons (does NOT awaitMessageComponent)', async () => {
    mockResolvePersonalityId.mockResolvedValue(PERSONALITY_ID);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalityId: PERSONALITY_ID,
        personalityName: PERSONALITY_NAME,
        personaId: 'persona-123',
        totalCount: 10,
        lockedCount: 2,
      },
    });
    const context = createMockContext();

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledTimes(1);
    const callArg = context.editReply.mock.calls[0][0];
    expect(callArg).toHaveProperty('embeds');
    expect(callArg).toHaveProperty('components');
  });
});

describe('handlePurgeButton (button routing)', () => {
  it('updates message on cancel', async () => {
    const interaction = createMockButtonInteraction(`${MEMORY_PURGE_PREFIX}::cancel::user-123`);

    await handlePurgeButton(interaction);

    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Purge cancelled.',
      embeds: [],
      components: [],
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('shows modal on proceed (no async work before showModal)', async () => {
    const interaction = createMockButtonInteraction(
      `${MEMORY_PURGE_PREFIX}::proceed::${PERSONALITY_ID}::user-123`
    );

    await handlePurgeButton(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.data.title).toBe('Confirm Memory Purge');
    expect(modal.data.custom_id).toBe(
      `${MEMORY_PURGE_PREFIX}::confirm::${PERSONALITY_ID}::user-123`
    );
  });

  it('rejects proceed without personalityId in customId', async () => {
    const interaction = createMockButtonInteraction(`${MEMORY_PURGE_PREFIX}::proceed::::user-123`);

    await handlePurgeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Malformed') })
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('rejects proceed when footer state missing', async () => {
    const interaction = createMockButtonInteraction(
      `${MEMORY_PURGE_PREFIX}::proceed::${PERSONALITY_ID}::user-123`,
      { footerText: null }
    );

    await handlePurgeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('missing required state') })
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('rejects unknown actions', async () => {
    const interaction = createMockButtonInteraction(`${MEMORY_PURGE_PREFIX}::nonsense`);

    await handlePurgeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Unknown') })
    );
  });

  it('rejects proceed click from a different user (cross-user guard)', async () => {
    const interaction = createMockButtonInteraction(
      `${MEMORY_PURGE_PREFIX}::proceed::${PERSONALITY_ID}::user-123`,
      { userId: 'user-OTHER' }
    );

    await handlePurgeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Only the person who ran this command'),
      })
    );
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  it('rejects cancel click from a different user (cross-user guard)', async () => {
    const interaction = createMockButtonInteraction(`${MEMORY_PURGE_PREFIX}::cancel::user-123`, {
      userId: 'user-OTHER',
    });

    await handlePurgeButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Only the person who ran this command'),
      })
    );
    expect(interaction.update).not.toHaveBeenCalled();
  });
});

describe('handlePurgeModal (modal submission)', () => {
  it('rejects mismatched confirmation phrase', async () => {
    const interaction = createMockModalInteraction('wrong phrase');

    await handlePurgeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('did not match') })
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('rejects case-mismatched confirmation phrase', async () => {
    const interaction = createMockModalInteraction('delete lilith memories');

    await handlePurgeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('did not match') })
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('trims whitespace before validating and forwards trimmed phrase to /purge/token', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          purgeToken: 'purge_test0000test0001',
          personalityId: PERSONALITY_ID,
          personalityName: PERSONALITY_NAME,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          deletedCount: 5,
          lockedPreserved: 0,
          personalityId: PERSONALITY_ID,
          personalityName: PERSONALITY_NAME,
          message: 'ok',
        },
      });
    const interaction = createMockModalInteraction(`  ${EXPECTED_PHRASE}  `);

    await handlePurgeModal(interaction);

    expect(mockCallGatewayApi).toHaveBeenNthCalledWith(
      1,
      '/user/memory/purge/token',
      expect.objectContaining({
        body: expect.objectContaining({ confirmationPhrase: EXPECTED_PHRASE }),
      })
    );
  });

  it('performs purge as token-handshake (issue → consume) and reports success', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          purgeToken: 'purge_test0000test0001',
          personalityId: PERSONALITY_ID,
          personalityName: PERSONALITY_NAME,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          deletedCount: 8,
          lockedPreserved: 2,
          personalityId: PERSONALITY_ID,
          personalityName: PERSONALITY_NAME,
          message: 'ok',
        },
      });
    const interaction = createMockModalInteraction(EXPECTED_PHRASE);

    await handlePurgeModal(interaction);

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Purging') })
    );
    expect(mockCallGatewayApi).toHaveBeenNthCalledWith(
      1,
      '/user/memory/purge/token',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          personalityId: PERSONALITY_ID,
          confirmationPhrase: EXPECTED_PHRASE,
        }),
      })
    );
    expect(mockCallGatewayApi).toHaveBeenNthCalledWith(
      2,
      '/user/memory/purge',
      expect.objectContaining({
        method: 'POST',
        body: { purgeToken: 'purge_test0000test0001' },
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });

  it('reports failure when token issuance fails (confirmation rejected server-side)', async () => {
    mockCallGatewayApi.mockResolvedValueOnce({ ok: false, error: 'Confirmation required' });
    const interaction = createMockModalInteraction(EXPECTED_PHRASE);

    await handlePurgeModal(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed to confirm') })
    );
    // Only the token-issue call should have run; no execute attempt.
    expect(mockCallGatewayApi).toHaveBeenCalledTimes(1);
  });

  it('reports failure when execute step fails after token issuance', async () => {
    mockCallGatewayApi
      .mockResolvedValueOnce({
        ok: true,
        data: {
          purgeToken: 'purge_test0000test0001',
          personalityId: PERSONALITY_ID,
          personalityName: PERSONALITY_NAME,
        },
      })
      .mockResolvedValueOnce({ ok: false, error: 'Database error' });
    const interaction = createMockModalInteraction(EXPECTED_PHRASE);

    await handlePurgeModal(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Failed to purge') })
    );
  });

  it('rejects modal with missing personalityId in customId', async () => {
    const interaction = createMockModalInteraction(EXPECTED_PHRASE, {
      customId: `${MEMORY_PURGE_PREFIX}::confirm::::user-123`,
    });

    await handlePurgeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Malformed') })
    );
  });

  it('rejects modal when footer state lost', async () => {
    const interaction = createMockModalInteraction(EXPECTED_PHRASE, { footerText: null });

    await handlePurgeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Confirmation state lost') })
    );
  });

  it('rejects modal submission from a different user (cross-user guard)', async () => {
    const interaction = createMockModalInteraction(EXPECTED_PHRASE, {
      customId: `${MEMORY_PURGE_PREFIX}::confirm::${PERSONALITY_ID}::user-123`,
      userId: 'user-OTHER',
    });

    await handlePurgeModal(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Only the person who ran this command'),
      })
    );
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });
});

describe('handlePurge top-level error catch (regression: was removed in routing refactor)', () => {
  it('catches unexpected errors and surfaces a friendly message', async () => {
    mockResolvePersonalityId.mockRejectedValue(new Error('Unexpected boom'));
    const context = createMockContext();

    await handlePurge(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('unexpected error'),
    });
  });
});
