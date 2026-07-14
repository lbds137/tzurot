/**
 * Tests for the /notifications command definition + routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const viewMock = vi.fn();
const onMock = vi.fn();
const offMock = vi.fn();
const levelMock = vi.fn();

vi.mock('./view.js', () => ({ handleNotificationsView: viewMock }));
vi.mock('./toggle.js', () => ({
  handleNotificationsEnable: onMock,
  handleNotificationsDisable: offMock,
}));
vi.mock('./level.js', () => ({ handleNotificationsLevel: levelMock }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const command = (await import('./index.js')).default;

function makeContext(subcommand: string) {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    getSubcommand: () => subcommand,
    getSubcommandGroup: () => null,
    editReply: vi.fn(),
  };
}

describe('/notifications command definition', () => {
  it('registers under the expected name with ephemeral deferral', () => {
    expect(command.data.name).toBe('notifications');
    expect(command.deferralMode).toBe('ephemeral');
  });

  it('declares the four subcommands with the level choices', () => {
    const json = command.data.toJSON();
    const names = (json.options ?? []).map(opt => opt.name).sort();
    expect(names).toEqual(['disable', 'enable', 'level', 'view']);

    const levelSub = (json.options ?? []).find(opt => opt.name === 'level') as {
      options?: { name: string; choices?: { value: string }[] }[];
    };
    const choices = levelSub.options?.[0]?.choices?.map(c => c.value).sort();
    expect(choices).toEqual(['major', 'minor', 'patch']);
  });
});

describe('/notifications routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['view', viewMock],
    ['enable', onMock],
    ['disable', offMock],
    ['level', levelMock],
  ])('routes %s to its handler', async (subcommand, handler) => {
    const context = makeContext(subcommand);

    await command.execute(context as never);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('replies with an error for an unknown subcommand', async () => {
    const context = makeContext('bogus');

    await command.execute(context as never);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Unknown subcommand'),
    });
  });
});
