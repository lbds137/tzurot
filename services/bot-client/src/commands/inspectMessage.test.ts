/**
 * Tests for the "Inspect Message" context-menu command.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApplicationCommandType } from 'discord.js';
import type { MessageContextMenuCommandInteraction } from 'discord.js';
import inspectMessageCommand from './inspectMessage.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock('./inspect/lookup.js', () => ({
  resolveDiagnosticLog: resolveMock,
}));

vi.mock('./inspect/embed.js', () => ({
  buildDiagnosticEmbed: vi.fn().mockReturnValue({ mock: 'embed' }),
}));

vi.mock('./inspect/components.js', () => ({
  buildInspectComponents: vi.fn().mockReturnValue([{ mock: 'components' }]),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

function makeInteraction(): MessageContextMenuCommandInteraction {
  return {
    targetId: '123456789012345678',
    user: { id: 'user-1' },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessageContextMenuCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  clientsForMock.mockReturnValue({ userClient: { stub: true } });
});

describe('Inspect Message context-menu command', () => {
  it('declares a MESSAGE-type context-menu command named "Inspect Message"', () => {
    const json = inspectMessageCommand.data.toJSON();
    expect(json.name).toBe('Inspect Message');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('feeds the target message id into the diagnostic lookup and renders the summary', async () => {
    resolveMock.mockResolvedValue({
      success: true,
      log: {
        requestId: 'req-1',
        personalityId: 'pers-1',
        data: { postProcessing: { thinkingContent: 'thoughts' } },
      },
    });
    const interaction = makeInteraction();

    await inspectMessageCommand.execute(interaction);

    // Seam: the right-clicked message's id is the lookup identifier
    expect(resolveMock).toHaveBeenCalledWith('123456789012345678', { stub: true });

    const { buildInspectComponents } = await import('./inspect/components.js');
    expect(vi.mocked(buildInspectComponents)).toHaveBeenCalledWith('req-1', 'thoughts'.length);

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ mock: 'embed' }],
      components: [{ mock: 'components' }],
    });
  });

  it('renders the lookup miss message when no diagnostic exists for the message', async () => {
    resolveMock.mockResolvedValue({
      success: false,
      errorMessage: 'No diagnostic log found for that message.',
    });
    const interaction = makeInteraction();

    await inspectMessageCommand.execute(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('No diagnostic log found'),
    });
  });

  it('classifies unexpected failures as read errors', async () => {
    resolveMock.mockRejectedValue(new Error('boom'));
    const interaction = makeInteraction();

    await inspectMessageCommand.execute(interaction);

    const { content } = vi.mocked(interaction.editReply).mock.calls[0][0] as { content: string };
    // Read classification: never claims a change may still be applying
    expect(content).not.toContain('may still');
    expect(content.length).toBeGreaterThan(0);
  });
});
