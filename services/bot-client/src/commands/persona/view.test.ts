/**
 * Tests for Profile View Handler
 * Tests gateway API calls and response rendering.
 *
 * Note: deferReply is handled by top-level interactionCreate handler,
 * so this handler uses editReply (not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleViewPersona } from './view.js';
import { mockListPersonasResponse, mockGetPersonaResponse } from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

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

describe('handleViewPersona', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleViewPersona>[0];
  }

  it('should show error when user has no personas', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a profile"),
    });
  });

  it('should show error when no default persona is set', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        { name: 'Test', isDefault: false },
        { name: 'Other', isDefault: false },
      ]),
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a default profile"),
    });
  });

  it('should display profile with all fields', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]),
    });
    // Second call returns persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          name: 'Test Profile',
          preferredName: 'TestUser',
          pronouns: 'they/them',
          content: 'I am a test user who loves programming',
          description: 'Test description',
          shareLtmAcrossPersonalities: false,
        },
      }),
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎭 Your Profile',
          }),
        }),
      ],
      components: [], // No expand button for short content
    });
  });

  it('should show LTM sharing enabled when flag is true', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]),
    });
    // Second call returns persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          name: 'Test Profile',
          preferredName: null,
          pronouns: null,
          content: '',
          description: null,
          shareLtmAcrossPersonalities: true,
        },
      }),
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0];
    const fields = embed.data.fields;
    const ltmField = fields.find((f: { name: string }) => f.name.includes('LTM'));

    expect(ltmField?.value).toContain('Enabled');
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
    });
  });
});
