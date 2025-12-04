/**
 * Tests for Character Autocomplete Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAutocomplete } from './autocomplete.js';

// Mock userGatewayClient
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

import { callGatewayApi } from '../../utils/userGatewayClient.js';

// Mock logger
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
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

describe('handleAutocomplete', () => {
  const mockRespond = vi.fn();
  const mockCallGatewayApi = vi.mocked(callGatewayApi);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespond.mockResolvedValue(undefined);
  });

  function createMockInteraction(
    focusedName: string,
    focusedValue: string,
    subcommand: string | null = 'edit'
  ) {
    return {
      user: { id: '123456789' },
      guildId: 'guild-123',
      commandName: 'character',
      options: {
        getFocused: vi.fn().mockReturnValue({
          name: focusedName,
          value: focusedValue,
        }),
        getSubcommand: vi.fn().mockReturnValue(subcommand),
      },
      respond: mockRespond,
    } as any;
  }

  it('should return empty array for non-character focused option', async () => {
    await handleAutocomplete(createMockInteraction('other-field', 'test'));

    expect(mockRespond).toHaveBeenCalledWith([]);
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should return owned characters for edit subcommand', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'my-char', name: 'MyChar', displayName: 'My Character', isOwned: true, isPublic: false },
          { slug: 'public-char', name: 'PublicChar', displayName: null, isOwned: false, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', '', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 My Character', value: 'my-char' },
    ]);
  });

  it('should return owned characters for avatar subcommand', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'my-char', name: 'MyChar', displayName: null, isOwned: true, isPublic: true },
          { slug: 'other', name: 'Other', displayName: null, isOwned: false, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', '', 'avatar'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🌐 MyChar', value: 'my-char' },
    ]);
  });

  it('should return all characters for view subcommand', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'my-char', name: 'MyChar', displayName: null, isOwned: true, isPublic: false },
          { slug: 'public-char', name: 'PublicChar', displayName: 'Public Bot', isOwned: false, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', '', 'view'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 MyChar', value: 'my-char' },
      { name: '📖 Public Bot', value: 'public-char' },
    ]);
  });

  it('should filter by query matching name', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'luna', name: 'Luna', displayName: null, isOwned: true, isPublic: true },
          { slug: 'lilith', name: 'Lilith', displayName: null, isOwned: true, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', 'lun', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🌐 Luna', value: 'luna' },
    ]);
  });

  it('should filter by query matching slug', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'my-bot-123', name: 'Bot', displayName: null, isOwned: true, isPublic: false },
          { slug: 'other', name: 'Other', displayName: null, isOwned: true, isPublic: false },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', 'bot-123', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 Bot', value: 'my-bot-123' },
    ]);
  });

  it('should filter by query matching displayName', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'char-1', name: 'Internal', displayName: 'Fancy Display Name', isOwned: true, isPublic: true },
          { slug: 'char-2', name: 'Other', displayName: null, isOwned: true, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', 'fancy', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🌐 Fancy Display Name', value: 'char-1' },
    ]);
  });

  it('should handle case-insensitive query', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'luna', name: 'Luna', displayName: null, isOwned: true, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', 'LUNA', 'edit'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🌐 Luna', value: 'luna' },
    ]);
  });

  it('should return empty array on API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'API error',
    });

    await handleAutocomplete(createMockInteraction('character', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should handle errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleAutocomplete(createMockInteraction('character', ''));

    expect(mockRespond).toHaveBeenCalledWith([]);
  });

  it('should limit results to Discord max choices', async () => {
    // Create 30 characters
    const personalities = Array.from({ length: 30 }, (_, i) => ({
      slug: `char-${i}`,
      name: `Character ${i}`,
      displayName: null,
      isOwned: true,
      isPublic: true,
    }));

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { personalities },
    });

    await handleAutocomplete(createMockInteraction('character', '', 'edit'));

    const call = mockRespond.mock.calls[0][0];
    expect(call.length).toBe(25); // DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES
  });

  it('should show correct visibility icons', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personalities: [
          { slug: 'private-owned', name: 'Private', displayName: null, isOwned: true, isPublic: false },
          { slug: 'public-owned', name: 'Public', displayName: null, isOwned: true, isPublic: true },
          { slug: 'public-other', name: 'Other', displayName: null, isOwned: false, isPublic: true },
        ],
      },
    });

    await handleAutocomplete(createMockInteraction('character', '', 'view'));

    expect(mockRespond).toHaveBeenCalledWith([
      { name: '🔒 Private', value: 'private-owned' },
      { name: '🌐 Public', value: 'public-owned' },
      { name: '📖 Other', value: 'public-other' },
    ]);
  });
});
