/**
 * Tests for Persona View Handler
 * Tests gateway API calls and response rendering.
 *
 * Note: deferReply is handled by top-level interactionCreate handler,
 * so this handler uses editReply (not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleViewPersona, handleExpandContent } from './view.js';
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
      content: expect.stringContaining("don't have a persona"),
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
      content: expect.stringContaining("don't have a default persona"),
    });
  });

  it('should display persona with all fields', async () => {
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
            title: '🎭 Your Persona',
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

  it('should show expand button for long content', async () => {
    const longContent = 'A'.repeat(1500); // Longer than CONTENT_PREVIEW_LENGTH
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]),
    });
    // Second call returns persona details with long content
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          name: 'Test Profile',
          preferredName: null,
          pronouns: null,
          content: longContent,
          description: null,
          shareLtmAcrossPersonalities: false,
        },
      }),
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    // Should have components (expand button)
    expect(call.components).toHaveLength(1);
  });

  it('should handle error when fetching details fails', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]),
    });
    // Second call fails
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: false,
      error: 'Failed to fetch details',
    });

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
    });
  });
});

describe('handleExpandContent', () => {
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
  const mockFollowUp = vi.fn();

  const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeferReply.mockResolvedValue(undefined);
  });

  function createMockButtonInteraction() {
    return {
      user: { id: '123456789' },
      deferReply: mockDeferReply,
      editReply: mockEditReply,
      followUp: mockFollowUp,
    } as unknown as Parameters<typeof handleExpandContent>[0];
  }

  it('should show full content when short', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test',
          content: 'Short content',
        },
      }),
    });

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Short content'));
    expect(mockFollowUp).not.toHaveBeenCalled();
  });

  it('should show not set message when content is empty', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test',
          content: '',
        },
      }),
    });

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Not set'));
  });

  it('should show not set message when content is null', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test',
          content: null,
          preferredName: null,
          pronouns: null,
          description: null,
          isDefault: false,
          shareLtmAcrossPersonalities: false,
        },
      },
    });

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Not set'));
  });

  it('should split very long content into multiple messages', async () => {
    // Create content longer than Discord's message limit
    const veryLongContent = 'A'.repeat(3000);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test',
          content: veryLongContent,
        },
      }),
    });

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalled();
  });

  it('should handle error when persona not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
  });
});
