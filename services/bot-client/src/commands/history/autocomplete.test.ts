/**
 * Tests for History Command Autocomplete
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePersonalityAutocomplete, handleProfileAutocomplete } from './autocomplete.js';

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
    DISCORD_LIMITS: {
      AUTOCOMPLETE_MAX_CHOICES: 25,
    },
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock personaAutocomplete
const mockHandlePersonaAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/personaAutocomplete.js', () => ({
  handlePersonaAutocomplete: (...args: unknown[]) => mockHandlePersonaAutocomplete(...args),
}));

describe('handlePersonalityAutocomplete', () => {
  const mockRespond = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(focusedValue: string = '') {
    return {
      user: { id: '123456789' },
      options: {
        getFocused: () => focusedValue,
      },
      respond: mockRespond,
    } as unknown as Parameters<typeof handlePersonalityAutocomplete>[0];
  }

  it('should return personality choices on successful fetch', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'lilith', name: 'Lilith', displayName: 'Lilith', isPublic: true, isOwner: false },
          {
            slug: 'custom',
            name: 'Custom',
            displayName: 'My Custom Bot',
            isPublic: false,
            isOwner: true,
          },
        ],
      },
    });

    const interaction = createMockInteraction();
    await handlePersonalityAutocomplete(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/personality', {
      userId: '123456789',
      method: 'GET',
    });
    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Lilith', value: 'lilith' },
      { name: 'My Custom Bot (yours)', value: 'custom' },
    ]);
  });

  it('should filter personalities by search term', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'lilith', name: 'Lilith', displayName: 'Lilith', isPublic: true, isOwner: false },
          {
            slug: 'default',
            name: 'Default',
            displayName: 'Default Bot',
            isPublic: true,
            isOwner: false,
          },
        ],
      },
    });

    const interaction = createMockInteraction('lil');
    await handlePersonalityAutocomplete(interaction);

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'Lilith', value: 'lilith' }]);
  });

  it('should filter by slug when displayName does not match', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          {
            slug: 'my-custom-bot',
            name: 'Custom',
            displayName: 'Special Bot',
            isPublic: false,
            isOwner: true,
          },
        ],
      },
    });

    const interaction = createMockInteraction('custom');
    await handlePersonalityAutocomplete(interaction);

    expect(mockRespond).toHaveBeenCalledWith([
      { name: 'Special Bot (yours)', value: 'my-custom-bot' },
    ]);
  });

  it('should return empty array on API failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const interaction = createMockInteraction();
    await handlePersonalityAutocomplete(interaction);

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should return empty array on exception', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    const interaction = createMockInteraction();
    await handlePersonalityAutocomplete(interaction);

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should use name when displayName is null', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'test', name: 'TestBot', displayName: null, isPublic: true, isOwner: false },
        ],
      },
    });

    const interaction = createMockInteraction();
    await handlePersonalityAutocomplete(interaction);

    expect(mockRespond).toHaveBeenCalledWith([{ name: 'TestBot', value: 'test' }]);
  });
});

describe('handleProfileAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delegate to handlePersonaAutocomplete with correct options', async () => {
    const mockInteraction = {} as Parameters<typeof handleProfileAutocomplete>[0];

    await handleProfileAutocomplete(mockInteraction);

    expect(mockHandlePersonaAutocomplete).toHaveBeenCalledWith(mockInteraction, {
      optionName: 'profile',
      includeCreateNew: false,
      logPrefix: '[History]',
    });
  });
});
