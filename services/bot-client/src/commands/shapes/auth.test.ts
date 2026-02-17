/**
 * Tests for Shapes Auth Subcommand
 *
 * Auth now just shows instruction embed + buttons, then returns.
 * Button handling (continue → modal, cancel) is in interactionHandlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleAuth, buildAuthModal } from './auth.js';
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

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function createMockContext(): ModalCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
      client: { user: { username: 'TestBot' } },
    } as unknown as ChatInputCommandInteraction;

    mockReply.mockResolvedValue(undefined);

    return {
      interaction: mockInteraction,
      user: mockInteraction.user,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'shapes',
      showModal: vi.fn(),
      reply: mockReply,
      deferReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('auth'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as ModalCommandContext;
  }

  it('should reply with instruction embed and buttons', async () => {
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
  });

  it('should use correct custom IDs for buttons', async () => {
    const context = createMockContext();
    await handleAuth(context);

    const replyArgs = mockReply.mock.calls[0][0];
    const buttons = replyArgs.components[0].components;
    expect(buttons).toHaveLength(2);

    // Continue button uses shapes:: prefix
    expect(buttons[0].data.custom_id).toBe('shapes::auth-continue');
    // Cancel button uses shapes:: prefix
    expect(buttons[1].data.custom_id).toBe('shapes::auth-cancel');
  });

  it('should include bot name in instruction text', async () => {
    const context = createMockContext();
    await handleAuth(context);

    const embed = mockReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain('TestBot');
  });
});

describe('buildAuthModal', () => {
  it('should build modal with correct custom ID', () => {
    const modal = buildAuthModal();
    expect(modal.data.custom_id).toBe('shapes::auth');
    expect(modal.data.title).toBe('Shapes.inc Authentication');
  });

  it('should have two text inputs for cookie parts', () => {
    const modal = buildAuthModal();
    expect(modal.components).toHaveLength(2);

    // Cast to access nested components — union type includes LabelBuilder without .components
    const rows = modal.components as { components: { data: Record<string, unknown> }[] }[];
    const part0 = rows[0].components[0];
    const part1 = rows[1].components[0];

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
});
