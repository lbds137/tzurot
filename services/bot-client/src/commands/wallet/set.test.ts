/**
 * Tests for Wallet Set Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextInputStyle } from 'discord.js';
import { handleSetKey } from './set.js';

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

  function createMockInteraction(provider: string = 'openrouter') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'provider') return provider;
          return null;
        },
      },
      showModal: mockShowModal,
    } as unknown as Parameters<typeof handleSetKey>[0];
  }

  it('should show modal for OpenRouter provider', async () => {
    const interaction = createMockInteraction('openrouter');
    await handleSetKey(interaction);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('wallet-set-openrouter');
    expect(modal.data.title).toBe('Set OpenRouter API Key');
  });

  it('should show modal for OpenAI provider', async () => {
    const interaction = createMockInteraction('openai');
    await handleSetKey(interaction);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('wallet-set-openai');
    expect(modal.data.title).toBe('Set OpenAI API Key');
  });

  it('should include API key text input with correct configuration', async () => {
    const interaction = createMockInteraction('openrouter');
    await handleSetKey(interaction);

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
    const interaction = createMockInteraction('openrouter');
    await handleSetKey(interaction);

    const modal = mockShowModal.mock.calls[0][0];
    const textInput = modal.components[0].components[0];

    expect(textInput.data.placeholder).toBe('sk-or-v1-...');
  });

  it('should use provider-specific placeholder for OpenAI', async () => {
    const interaction = createMockInteraction('openai');
    await handleSetKey(interaction);

    const modal = mockShowModal.mock.calls[0][0];
    const textInput = modal.components[0].components[0];

    expect(textInput.data.placeholder).toBe('sk-...');
  });

  it('should handle unknown provider gracefully', async () => {
    const interaction = createMockInteraction('unknown-provider');
    await handleSetKey(interaction);

    expect(mockShowModal).toHaveBeenCalledTimes(1);
    const modal = mockShowModal.mock.calls[0][0];

    expect(modal.data.custom_id).toBe('wallet-set-unknown-provider');
    expect(modal.data.title).toBe('Set unknown-provider API Key');
  });
});
