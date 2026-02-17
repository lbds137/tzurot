/**
 * Tests for Shapes Auth Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle } from 'discord.js';
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
  const mockShowModal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): ModalCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
      showModal: mockShowModal,
    } as unknown as ChatInputCommandInteraction;

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
      reply: vi.fn(),
      deferReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('auth'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as ModalCommandContext;
  }

  it('should show modal with correct custom_id and title', async () => {
    const context = createMockContext();
    await handleAuth(context);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('shapes::auth');
    expect(modal.data.title).toBe('Shapes.inc Authentication');
  });

  it('should include two text inputs for cookie parts', async () => {
    const context = createMockContext();
    await handleAuth(context);

    const modal = mockShowModal.mock.calls[0][0];
    expect(modal.components).toHaveLength(2);

    const part0 = modal.components[0].components[0];
    const part1 = modal.components[1].components[0];

    expect(part0.data.custom_id).toBe('cookiePart0');
    expect(part1.data.custom_id).toBe('cookiePart1');
  });

  it('should configure text inputs as paragraph style', async () => {
    const context = createMockContext();
    await handleAuth(context);

    const modal = mockShowModal.mock.calls[0][0];
    const part0 = modal.components[0].components[0];
    const part1 = modal.components[1].components[0];

    expect(part0.data.style).toBe(TextInputStyle.Paragraph);
    expect(part1.data.style).toBe(TextInputStyle.Paragraph);
  });

  it('should require first input and make second optional', async () => {
    const context = createMockContext();
    await handleAuth(context);

    const modal = mockShowModal.mock.calls[0][0];
    const part0 = modal.components[0].components[0];
    const part1 = modal.components[1].components[0];

    expect(part0.data.required).toBe(true);
    expect(part0.data.min_length).toBe(10);
    expect(part0.data.max_length).toBe(4000);

    expect(part1.data.required).toBe(false);
    expect(part1.data.max_length).toBe(4000);
  });
});
