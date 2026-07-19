/**
 * Tests for Settings API Key Set Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleSetKey } from './set.js';
import type { ModalCommandContext } from '../../../utils/commandContext/types.js';

// Mock common-types
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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

  /** JSON shape of the modal's single Label-hosted text input. */
  function getLabelAndInput(modal: { toJSON: () => { components: unknown[] } }): {
    label: { description?: string };
    input: Record<string, unknown>;
  } {
    const json = modal.toJSON();
    expect(json.components).toHaveLength(1);
    const label = json.components[0] as { description?: string; component?: unknown };
    return { label, input: label.component as Record<string, unknown> };
  }

  it('should include API key text input with correct configuration', async () => {
    const context = createMockContext('openrouter');
    await handleSetKey(context);

    const { label, input } = getLabelAndInput(mockShowModal.mock.calls[0][0]);

    expect(input.custom_id).toBe('apiKey');
    expect(input.style).toBe(TextInputStyle.Short);
    expect(input.required).toBe(true);
    expect(input.min_length).toBe(10);
    expect(input.max_length).toBe(200);
    // The provider's key-management URL rides as inline Label docs (D15)
    expect(label.description).toContain('openrouter.ai/keys');
  });

  it('should use provider-specific placeholder for OpenRouter', async () => {
    const context = createMockContext('openrouter');
    await handleSetKey(context);

    const { input } = getLabelAndInput(mockShowModal.mock.calls[0][0]);
    expect(input.placeholder).toBe('sk-or-v1-xxxx...');
  });

  it('should show modal for ZaiCoding provider with z.ai-specific labels', async () => {
    const context = createMockContext('zai-coding');
    await handleSetKey(context);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('settings::apikey::set::zai-coding');
    expect(modal.data.title).toBe('Set Z.AI Coding Plan API Key');
    const { input } = getLabelAndInput(modal);
    expect(input.placeholder).toBe('Your z.ai coding-plan API key');
  });
});
