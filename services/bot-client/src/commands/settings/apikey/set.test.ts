/**
 * Tests for Settings API Key Set Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSetKey } from './set.js';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';

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

describe('handleSetKey', () => {
  const mockShowModal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(provider: string = 'openrouter'): ModalCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'provider') return provider;
          return null;
        },
      },
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
      commandName: 'settings',
      showModal: mockShowModal,
      reply: vi.fn(),
      deferReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('set'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as ModalCommandContext;
  }

  it('should show modal for OpenRouter provider', async () => {
    const context = createMockContext('openrouter');
    await handleSetKey(context);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('settings::apikey::set::openrouter');
    expect(modal.data.title).toBe('Set OpenRouter API Key');
  });

  it('should include API key text input with correct configuration', async () => {
    const context = createMockContext('openrouter');
    await handleSetKey(context);

    const modal = mockShowModal.mock.calls[0][0];
    const components = modal.components;

    expect(components).toHaveLength(1);
    const actionRow = components[0];
    const textInput = actionRow.components[0];

    expect(textInput.data.custom_id).toBe('apiKey');
    expect(textInput.data.style).toBe(TextInputStyle.Short);
    expect(textInput.data.required).toBe(true);
    expect(textInput.data.min_length).toBe(10);
    expect(textInput.data.max_length).toBe(200);
  });

  it('should use provider-specific placeholder for OpenRouter', async () => {
    const context = createMockContext('openrouter');
    await handleSetKey(context);

    const modal = mockShowModal.mock.calls[0][0];
    const textInput = modal.components[0].components[0];

    expect(textInput.data.placeholder).toBe('sk-or-v1-xxxx...');
  });
});
