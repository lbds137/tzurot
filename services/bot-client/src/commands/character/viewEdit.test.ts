/**
 * Tests for the view → edit dashboard transition (handleViewEdit).
 *
 * The ack-shape fork is the load-bearing behavior: a classic embed view is
 * edited in place (deferUpdate), while a Components-V2 source message must
 * get a NEW ephemeral reply (deferReply) because the V2 flag forbids embeds
 * on edits of the original message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} })),
}));

vi.mock('./api.js', () => ({
  fetchCharacter: vi.fn(),
}));

const mockSessionSet = vi.fn();
vi.mock('../../utils/dashboard/index.js', () => ({
  buildDashboardEmbed: vi.fn(() => ({ mock: 'embed' })),
  buildDashboardComponents: vi.fn(() => [{ mock: 'components' }]),
  getSessionManager: () => ({ set: mockSessionSet }),
}));

vi.mock('./config.js', () => ({
  getCharacterDashboardConfig: vi.fn(() => ({ entityType: 'character' })),
  buildCharacterDashboardOptions: vi.fn(() => ({ showRefresh: true, showDelete: true })),
}));

const mockIsBotOwner = vi.fn();
vi.mock('@tzurot/common-types/utils/ownerMiddleware', () => ({
  isBotOwner: (id: string) => mockIsBotOwner(id),
  // Runtime passthrough — the IsAdmin brand is compile-time only, so the handler's
  // asIsAdmin(isBotOwner(...)) wrap must not vanish under this mock.
  asIsAdmin: (v: boolean) => v,
}));

// reply.js is deliberately NOT mocked: the error-delivery seam (editReply
// after deferReply vs followUp after deferUpdate) is exactly what this suite
// must exercise for real — a prior version mocked it and shipped a clobber bug.
import { handleViewEdit } from './viewEdit.js';
import { fetchCharacter } from './api.js';
import { buildDashboardComponents } from '../../utils/dashboard/index.js';
import { getCharacterDashboardConfig } from './config.js';

const CONFIG = {} as never;

function createCharacter(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'test-slug',
    name: 'Test',
    displayName: 'Test Character',
    hasVoiceReference: false,
    canEdit: true,
    ...overrides,
  };
}

function createInteraction(sourceIsV2: boolean): ButtonInteraction {
  return {
    customId: 'character::view-edit::test-slug',
    user: { id: 'user-1' },
    channelId: 'chan-1',
    // Post-ack state for the real replyContent matrix: both deferReply and
    // deferUpdate leave deferred=true/replied=false — which is precisely why
    // the delivery method must be chosen by the caller, not inferred here.
    deferred: true,
    replied: false,
    message: {
      id: 'source-msg',
      flags: { has: vi.fn((flag: number) => sourceIsV2 && flag === MessageFlags.IsComponentsV2) },
    },
    deferUpdate: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(async () => ({ id: sourceIsV2 ? 'new-ephemeral-msg' : 'source-msg' })),
    followUp: vi.fn(async () => ({ id: 'followup-msg' })),
  } as unknown as ButtonInteraction;
}

describe('handleViewEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a non-admin character owner (canEdit true, isBotOwner false) —
    // the case that would leak the admin section if isAdmin were mis-derived.
    mockIsBotOwner.mockReturnValue(false);
  });

  it('edits the classic embed view into the dashboard in place', async () => {
    vi.mocked(fetchCharacter).mockResolvedValue(createCharacter() as never);
    const interaction = createInteraction(false);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ mock: 'embed' }],
      components: [{ mock: 'components' }],
    });
    // Session rides the message the dashboard landed on (the source message)
    expect(mockSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'test-slug', messageId: 'source-msg' })
    );
  });

  it('opens a new ephemeral reply when the source message is Components V2', async () => {
    vi.mocked(fetchCharacter).mockResolvedValue(createCharacter() as never);
    const interaction = createInteraction(true);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'new-ephemeral-msg' })
    );
  });

  it('threads the fetched character across the dashboard-builder seam', async () => {
    const character = createCharacter({ hasVoiceReference: true });
    vi.mocked(fetchCharacter).mockResolvedValue(character as never);

    await handleViewEdit(createInteraction(false), 'test-slug', CONFIG);

    expect(fetchCharacter).toHaveBeenCalledWith('test-slug', CONFIG, expect.anything());
    expect(buildDashboardComponents).toHaveBeenCalledWith(
      expect.anything(),
      'test-slug',
      expect.objectContaining({ slug: 'test-slug', hasVoiceReference: true }),
      expect.objectContaining({ showDelete: true })
    );
  });

  it('derives the dashboard admin gate from isBotOwner, NOT canEdit', async () => {
    // The bug this pins: a non-admin OWNER (canEdit true, isBotOwner false)
    // must NOT get the bot-owner-only admin section. getCharacterDashboardConfig's
    // first arg is isAdmin — passing canEdit here leaks the admin section on
    // the initial render.
    mockIsBotOwner.mockReturnValue(false);
    vi.mocked(fetchCharacter).mockResolvedValue(
      createCharacter({ canEdit: true, hasVoiceReference: false }) as never
    );

    await handleViewEdit(createInteraction(false), 'test-slug', CONFIG);

    expect(mockIsBotOwner).toHaveBeenCalledWith('user-1');
    expect(getCharacterDashboardConfig).toHaveBeenCalledWith(false, false);
    // The stored session carries the derived flag, matching every other
    // dashboard-opening path.
    expect(mockSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ _isAdmin: false }) })
    );
  });

  it('passes isAdmin=true when the viewer is the bot owner', async () => {
    mockIsBotOwner.mockReturnValue(true);
    vi.mocked(fetchCharacter).mockResolvedValue(createCharacter({ canEdit: true }) as never);

    await handleViewEdit(createInteraction(false), 'test-slug', CONFIG);

    expect(getCharacterDashboardConfig).toHaveBeenCalledWith(true, false);
    expect(mockSessionSet).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ _isAdmin: true }) })
    );
  });

  it('reports not-found via followUp on the deferUpdate path — never clobbering the view', async () => {
    // The bug this pins: after deferUpdate, editReply would overwrite the
    // character-view message with a bare error. The error must ship as an
    // ephemeral followUp, leaving the view intact.
    vi.mocked(fetchCharacter).mockResolvedValue(null);
    const interaction = createInteraction(false);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not found') })
    );
    // editReply is the clobber path here — it must NOT be used for the error.
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('rejects a stale button via followUp on the deferUpdate path', async () => {
    vi.mocked(fetchCharacter).mockResolvedValue(createCharacter({ canEdit: false }) as never);
    const interaction = createInteraction(false);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('permission') })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('delivers the error via editReply (ephemeral placeholder) on the V2 deferReply path', async () => {
    // The V2 source went through deferReply, so replySpec→editReply correctly
    // fills the fresh ephemeral reply (no view to clobber). followUp would be wrong.
    vi.mocked(fetchCharacter).mockResolvedValue(null);
    const interaction = createInteraction(true);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not found') })
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });

  it('classifies a gateway failure via followUp on the deferUpdate path', async () => {
    vi.mocked(fetchCharacter).mockRejectedValue(new Error('boom'));
    const interaction = createInteraction(false);

    await handleViewEdit(interaction, 'test-slug', CONFIG);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(mockSessionSet).not.toHaveBeenCalled();
  });
});
