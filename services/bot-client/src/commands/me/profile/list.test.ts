/**
 * Tests for Profile List Handler
 * Tests gateway API calls and response rendering.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListPersonas } from './list.js';
import { mockListPersonasResponse } from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
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

describe('handleListPersonas', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext() {
    return {
      user: { id: '123456789', username: 'testuser' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleListPersonas>[0];
  }

  it('should show empty state when user has no profiles', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any profiles yet"),
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
    });
  });

  it('should list user personas with embed', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Default Persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I love coding',
          isDefault: true,
        },
        {
          name: 'Work Persona',
          preferredName: 'Professional Alice',
          pronouns: null,
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: '📋 Your Profiles',
          }),
        }),
      ]),
    });
  });

  it('should mark default persona with star', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'My Persona',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: true,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    // The field name should contain star for default
    expect(embed.fields[0].name).toContain('⭐');
    expect(embed.fields[0].name).toContain('(default)');
  });

  it('should show persona count in description', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Persona 1',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
        {
          name: 'Persona 2',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
        {
          name: 'Persona 3',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.description).toContain('3');
    expect(embed.description).toContain('profiles');
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
    });
  });

  it('should truncate long content in preview', async () => {
    const longContent = 'x'.repeat(200);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Long Content Persona',
          preferredName: null,
          pronouns: null,
          content: longContent,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.fields[0].value).toContain('...');
  });

  it('should escape markdown characters in persona name', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: '**Bold** _Persona_',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    // Field name should have escaped markdown
    expect(embed.fields[0].name).toContain('\\*\\*Bold\\*\\*');
    expect(embed.fields[0].name).toContain('\\_Persona\\_');
  });

  it('should escape markdown characters in preferredName and pronouns', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Test Persona',
          preferredName: '*Star* User',
          pronouns: '`code`/pronouns',
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    const fieldValue = embed.fields[0].value;

    // Verify preferredName and pronouns are escaped
    expect(fieldValue).toContain('\\*Star\\*');
    expect(fieldValue).toContain('\\`code\\`');
  });

  it('should escape markdown characters in content preview', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Test Persona',
          preferredName: null,
          pronouns: null,
          content: '**Bold content** with _italics_',
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    const fieldValue = embed.fields[0].value;

    // Verify content is escaped
    expect(fieldValue).toContain('\\*\\*Bold content\\*\\*');
    expect(fieldValue).toContain('\\_italics\\_');
  });
});
