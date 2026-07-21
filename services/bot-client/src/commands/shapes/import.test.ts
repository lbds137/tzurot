/**
 * Tests for Shapes Import Subcommand
 *
 * Import now shows confirmation embed + buttons, then returns.
 * Button handling (confirm → startImport, cancel) is in interactionHandlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageComponentInteraction } from 'discord.js';
import { handleImport, startImport } from './import.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

describe('handleImport', () => {
  const mockEditReply = vi.fn();
  const mockGetString = vi.fn();
  let stub: {
    getShapesAuthStatus: ReturnType<typeof vi.fn>;
    startShapesImport: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetString.mockImplementation((name: string) => {
      if (name === 'slug') return 'test-character';
      if (name === 'import-type') return null;
      return null;
    });
    stub = {
      getShapesAuthStatus: vi.fn(),
      startShapesImport: vi.fn(),
    };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(): DeferredCommandContext {
    return {
      user: { id: '123456789', username: 'testuser' },
      editReply: mockEditReply,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'shapes',
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('import'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: { getString: mockGetString },
      },
    } as unknown as DeferredCommandContext;
  }

  it('should check credentials before importing', async () => {
    stub.getShapesAuthStatus.mockResolvedValue(makeErr(401, 'No credentials'));

    const context = createMockContext();
    await handleImport(context);

    expect(stub.getShapesAuthStatus).toHaveBeenCalled();
  });

  it('should show auth prompt when no credentials exist', async () => {
    stub.getShapesAuthStatus.mockResolvedValue(
      makeOk({ hasCredentials: false, service: 'shapes_inc' })
    );

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No shapes.inc credentials'),
    });
  });

  it('should show confirmation embed with correct custom IDs', async () => {
    stub.getShapesAuthStatus.mockResolvedValue(
      makeOk({ hasCredentials: true, service: 'shapes_inc' })
    );

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Import from Shapes.inc'),
            }),
          }),
        ]),
        components: expect.arrayContaining([expect.anything()]),
      })
    );

    const replyArgs = mockEditReply.mock.calls[0][0];
    const buttons = replyArgs.components[0].components;
    expect(buttons[0].data.custom_id).toMatch(/^shapes::import-confirm::/);
    expect(buttons[1].data.custom_id).toBe('shapes::import-cancel');
  });

  it('should encode import type in custom ID and slug in embed footer', async () => {
    stub.getShapesAuthStatus.mockResolvedValue(
      makeOk({ hasCredentials: true, service: 'shapes_inc' })
    );

    const context = createMockContext();
    await handleImport(context);

    const replyArgs = mockEditReply.mock.calls[0][0];
    const confirmButton = replyArgs.components[0].components[0];
    expect(confirmButton.data.custom_id).toBe('shapes::import-confirm::full');

    const embed = replyArgs.embeds[0];
    expect(embed.data.footer.text).toBe('slug:test-character');
  });

  it('should normalize slug to lowercase and trim whitespace', async () => {
    mockGetString.mockImplementation((name: string) => {
      if (name === 'slug') return '  Test-Character  ';
      return null;
    });
    stub.getShapesAuthStatus.mockResolvedValue(
      makeOk({ hasCredentials: true, service: 'shapes_inc' })
    );

    const context = createMockContext();
    await handleImport(context);

    const replyArgs = mockEditReply.mock.calls[0][0];
    expect(replyArgs.embeds[0].data.footer.text).toBe('slug:test-character');
  });

  it('should handle network errors gracefully', async () => {
    stub.getShapesAuthStatus.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleImport(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load the shapes import'),
    });
  });

  it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
    mockGetString.mockImplementation((name: string) => {
      if (name === 'slug') return '__autocomplete_error__';
      return null;
    });

    const context = createMockContext();
    await handleImport(context);

    expect(stub.getShapesAuthStatus).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});

describe('startImport', () => {
  const mockUpdate = vi.fn();
  const mockEditReply = vi.fn();
  let stub: { startShapesImport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    stub = { startShapesImport: vi.fn() };
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockButtonInteraction() {
    return {
      user: { id: '123456789', username: 'testuser' },
      update: mockUpdate,
      editReply: mockEditReply,
    } as unknown as MessageComponentInteraction;
  }

  it('should call gateway import API with correct params', async () => {
    stub.startShapesImport.mockResolvedValue(
      makeOk({ importJobId: 'job-123', sourceSlug: 'test', importType: 'full', status: 'pending' })
    );

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(stub.startShapesImport).toHaveBeenCalledWith({
      sourceSlug: 'test-shape',
      importType: 'full',
    });
  });

  it('should show success embed on successful import', async () => {
    stub.startShapesImport.mockResolvedValue(
      makeOk({ importJobId: 'job-123', sourceSlug: 'test', importType: 'full', status: 'pending' })
    );

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: expect.stringContaining('Import Started'),
            }),
          }),
        ],
      })
    );
  });

  it('should show conflict error for 409', async () => {
    stub.startShapesImport.mockResolvedValue(makeErr(409, 'Already running'));

    const interaction = createMockButtonInteraction();
    await startImport(interaction, '123456789', {
      slug: 'test-shape',
      importType: 'full',
    });

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              description: expect.stringContaining('already in progress'),
            }),
          }),
        ],
      })
    );
  });
});
