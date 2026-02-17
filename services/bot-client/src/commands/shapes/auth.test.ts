/**
 * Tests for Shapes Auth Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleAuth } from './auth.js';
import type { ModalCommandContext } from '../../utils/commandContext/types.js';

// Mock common-types
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

describe('handleAuth', () => {
  const mockReply = vi.fn();
  const mockShowModal = vi.fn();
  const mockAwaitMessageComponent = vi.fn();
  const mockEdit = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockContext(): ModalCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
      showModal: mockShowModal,
    } as unknown as ChatInputCommandInteraction;

    mockReply.mockResolvedValue({
      awaitMessageComponent: mockAwaitMessageComponent,
      edit: mockEdit,
    });

    return {
      interaction: mockInteraction,
      user: mockInteraction.user,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'shapes',
      showModal: mockShowModal,
      reply: mockReply,
      deferReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('auth'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as ModalCommandContext;
  }

  it('should reply with instruction embed and buttons', async () => {
    const mockButtonInteraction = {
      customId: 'shapes-auth-continue',
      showModal: vi.fn(),
    };
    mockAwaitMessageComponent.mockResolvedValue(mockButtonInteraction);

    const context = createMockContext();
    await handleAuth(context);

    expect(mockReply).toHaveBeenCalledTimes(1);
    const replyArgs = mockReply.mock.calls[0][0];

    // Ephemeral
    expect(replyArgs.flags).toBe(MessageFlags.Ephemeral);

    // Has embed with instructions
    expect(replyArgs.embeds).toHaveLength(1);
    const embed = replyArgs.embeds[0];
    expect(embed.data.title).toBe('Shapes.inc Authentication');
    expect(embed.data.description).toContain('Developer Tools');
    expect(embed.data.description).toContain('Application');
    expect(embed.data.description).toContain('appSession');

    // Has buttons
    expect(replyArgs.components).toHaveLength(1);
    const buttons = replyArgs.components[0].components;
    expect(buttons).toHaveLength(2);
  });

  it('should show modal when continue button is clicked', async () => {
    const buttonShowModal = vi.fn();
    const mockButtonInteraction = {
      customId: 'shapes-auth-continue',
      showModal: buttonShowModal,
    };
    mockAwaitMessageComponent.mockResolvedValue(mockButtonInteraction);

    const context = createMockContext();
    await handleAuth(context);

    // Modal shown from button interaction, not from original context
    expect(mockShowModal).not.toHaveBeenCalled();
    expect(buttonShowModal).toHaveBeenCalledTimes(1);

    const modal = buttonShowModal.mock.calls[0][0];
    expect(modal.data.custom_id).toBe('shapes::auth');
    expect(modal.data.title).toBe('Shapes.inc Authentication');
  });

  it('should build modal with two text inputs', async () => {
    const buttonShowModal = vi.fn();
    mockAwaitMessageComponent.mockResolvedValue({
      customId: 'shapes-auth-continue',
      showModal: buttonShowModal,
    });

    const context = createMockContext();
    await handleAuth(context);

    const modal = buttonShowModal.mock.calls[0][0];
    expect(modal.components).toHaveLength(2);

    const part0 = modal.components[0].components[0];
    const part1 = modal.components[1].components[0];

    expect(part0.data.custom_id).toBe('cookiePart0');
    expect(part0.data.style).toBe(TextInputStyle.Paragraph);
    expect(part0.data.required).toBe(true);
    expect(part0.data.min_length).toBe(10);
    expect(part0.data.max_length).toBe(4000);

    expect(part1.data.custom_id).toBe('cookiePart1');
    expect(part1.data.style).toBe(TextInputStyle.Paragraph);
    expect(part1.data.required).toBe(false);
    expect(part1.data.max_length).toBe(4000);
  });

  it('should handle cancel button', async () => {
    const mockUpdate = vi.fn();
    mockAwaitMessageComponent.mockResolvedValue({
      customId: 'shapes-auth-cancel',
      update: mockUpdate,
    });

    const context = createMockContext();
    await handleAuth(context);

    expect(mockUpdate).toHaveBeenCalledWith({
      content: 'Authentication cancelled.',
      embeds: [],
      components: [],
    });
    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('should handle timeout', async () => {
    mockAwaitMessageComponent.mockRejectedValue(new Error('Collector timed out'));

    const context = createMockContext();
    await handleAuth(context);

    expect(mockEdit).toHaveBeenCalledWith({
      content: 'Authentication timed out. Run `/shapes auth` again when ready.',
      embeds: [],
      components: [],
    });
    expect(mockShowModal).not.toHaveBeenCalled();
  });
});
