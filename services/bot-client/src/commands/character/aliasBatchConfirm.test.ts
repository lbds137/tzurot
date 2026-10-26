/**
 * Tests for the character alias batch confirm flow (aliasBatchConfirm.ts) —
 * per-item resolution, sequential removal with failure isolation, and report
 * delivery via the shared survival ladder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import {
  FIVE_ROWS,
  characterAliasesPayload,
  createButtonInteraction as createBaseButtonInteraction,
  editReplyEmbeds,
  makeAliasRow,
  mockUserClient,
  myAliasesPayload,
} from '../../test/mocks/aliasBatch.mock.js';
import {
  BATCH_CONFIRM_PREFIX,
  MAX_BATCH_FOOTER_LENGTH,
  SELECTION_TOO_LARGE_COPY,
  encodeAliasBatchFooterIds,
} from './aliasBatch.js';
import { handleAliasBatchConfirm } from './aliasBatchConfirm.js';
import {
  SELECT_ALIAS_KEY_LENGTH,
  buildRemoveCustomId,
  formatAliasSelectValue,
} from './aliasBrowseView.js';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const clientsForMock = vi.hoisted(() => vi.fn());

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => loggerMock,
  };
});

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: (...args: unknown[]) => clientsForMock(...args),
}));

function createButtonInteraction(
  options: Parameters<typeof createBaseButtonInteraction>[0] = {}
): ReturnType<typeof createBaseButtonInteraction> {
  const interaction = createBaseButtonInteraction(options);
  vi.mocked(interaction.deferUpdate).mockImplementation(() => {
    (interaction as { deferred: boolean }).deferred = true;
    return Promise.resolve(undefined as never);
  });
  vi.mocked(interaction.followUp).mockImplementation(() => {
    if (!interaction.deferred && !interaction.replied) {
      return Promise.reject(
        new Error('The reply to this interaction has not been sent or deferred.')
      );
    }
    return Promise.resolve(undefined as never);
  });
  return interaction;
}

describe('C1 — handleAliasBatchConfirm (partial failure & already-gone named, loop reaches all)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: mockUserClient });
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('reaches all 5 aliases when #2 returns a 404 envelope, naming #2 failed with neutral copy and the other 4 succeeded (C1)', async () => {
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) => {
        if (alias === 'lila') {
          return Promise.resolve({
            ok: false,
            status: 404,
            error: 'Alias not found',
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        });
      }
    );

    const pickedValues = FIVE_ROWS.map(formatAliasSelectValue);
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(pickedValues),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(5);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(1, 'lilith', 'mommy', {
      scope: 'user',
    });
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      2,
      'lila-elyona',
      'lila',
      { scope: 'global' }
    );
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(3, 'lilith', 'queen', {
      scope: 'user',
    });
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(4, 'nyx', 'boss', {
      scope: 'global',
    });
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      5,
      'lila-elyona',
      'star',
      { scope: 'user' }
    );

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @mommy');
    expect(resultEmbed.description).toContain('❌ @lila — Character or alias not found.');
    expect(resultEmbed.description).toContain('✅ @queen');
    expect(resultEmbed.description).toContain('✅ @boss');
    expect(resultEmbed.description).toContain('✅ @star');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: 4, gone: 0, failed: 1 }),
      'Batch alias removal finished'
    );
  });

  it('names every alias failed with neutral copy and reports the ERROR colour when every removal returns a 404 envelope (C1 all-404)', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Alias not found',
    });

    const pickedValues = FIVE_ROWS.map(formatAliasSelectValue);
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(pickedValues),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(5);
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌ @mommy — Character or alias not found.');
    expect(resultEmbed.description).toContain('❌ @star — Character or alias not found.');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: 0, gone: 0, failed: 5 }),
      'Batch alias removal finished'
    );
  });

  it('reaches all 5 aliases when #2 fails with a non-404 error envelope, isolating the thrown failure (C1 partial failure)', async () => {
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) => {
        if (alias === 'lila') {
          return Promise.resolve({
            ok: false,
            status: 403,
            error: 'Forbidden',
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        });
      }
    );

    const pickedValues = FIVE_ROWS.map(formatAliasSelectValue);
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(pickedValues),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(5);
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @mommy');
    expect(resultEmbed.description).toContain('❌ @lila');
    // The line's single ❌ is formatBatchItemLines' status glyph; the note is
    // the spec's plain text — a rendered spec string would double the glyph.
    const failureLine = resultEmbed.description?.split('\n').find(line => line.includes('@lila'));
    expect(failureLine).toBe(
      '❌ @lila — You do not have permission to manage aliases for this character.'
    );
    expect(failureLine?.match(/❌/g)).toHaveLength(1);
    expect(resultEmbed.description).toContain('✅ @queen');
    expect(resultEmbed.description).toContain('✅ @boss');
    expect(resultEmbed.description).toContain('✅ @star');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('resolves and removes when a picked value differs in case from the re-fetched row', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'queen', removedScope: 'user' },
    });

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:Queen']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', 'queen', {
      scope: 'user',
    });
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @queen');
  });

  it('refuses with validation copy when the confirm message has no footer', async () => {
    const interaction = createButtonInteraction({});

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't tell which aliases were selected"),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('refuses with validation copy when the confirm footer has malformed percent-encoding', async () => {
    const interaction = createButtonInteraction({
      footerText: '%zz',
    });

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't tell which aliases were selected"),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('refuses with expiry copy when the confirm customId coordinates are malformed', async () => {
    const interaction = createButtonInteraction({
      customId: 'character-alias::batch-confirm::bad::filter::',
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Session expired'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('strips confirm components BEFORE the pre-loop fetch and before any removal call', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'mommy', removedScope: 'user' },
    });
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(vi.mocked(interaction.editReply).mock.calls[0]?.[0]).toEqual({ components: [] });
    const stripOrder = vi.mocked(interaction.editReply).mock.invocationCallOrder[0];
    const fetchOrder = mockUserClient.listMyAliases.mock.invocationCallOrder[0];
    const removeOrder = mockUserClient.removePersonalityAlias.mock.invocationCallOrder[0];
    expect(stripOrder).toBeLessThan(fetchOrder);
    expect(stripOrder).toBeLessThan(removeOrder);
  });

  it('refuses with transient copy before any mutation when the pre-loop page fetch fails', async () => {
    mockUserClient.listMyAliases.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'boom',
    });
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
      })
    );
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('refuses with transient copy and makes no fetch or removal call when stripping the confirm components throws', async () => {
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });
    vi.mocked(interaction.editReply).mockRejectedValueOnce(new Error('strip failed'));

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('isolates a transport rejection on removePersonalityAlias, logs warn with ids only, and continues remaining items (C6)', async () => {
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) => {
        if (alias === 'lila') {
          return Promise.reject(new Error('ECONNRESET'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        });
      }
    );

    const pickedValues = FIVE_ROWS.slice(0, 3).map(formatAliasSelectValue);
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(pickedValues),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(3);
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @mommy');
    expect(resultEmbed.description).toContain(
      '❌ @lila — Failed to manage aliases. Please try again.'
    );
    expect(resultEmbed.description).toContain('✅ @queen');
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        userId: 'user-1',
        slug: 'lila-elyona',
        scope: 'global',
      }),
      'Batch alias removal item threw'
    );
    const warnPayload = loggerMock.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(warnPayload).not.toHaveProperty('alias');
    expect(Object.keys(warnPayload).sort()).toEqual(['err', 'scope', 'slug', 'userId']);
  });

  it('isolates a status-0 network-failure envelope on removePersonalityAlias with generic copy, never leaking the raw error, while remaining items succeed (C14)', async () => {
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) => {
        if (alias === 'lila') {
          return Promise.resolve({
            ok: false,
            kind: 'network',
            error: 'fetch failed',
            status: 0,
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        });
      }
    );

    const pickedValues = FIVE_ROWS.slice(0, 2).map(formatAliasSelectValue);
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(pickedValues),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(2);
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @mommy');
    expect(resultEmbed.description).toContain(
      '❌ @lila — Failed to manage aliases. Please try again.'
    );
    expect(resultEmbed.description).not.toContain('fetch failed');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('marks an invalid-scope footer id as FAILED with the resolution-failure copy without calling removePersonalityAlias while still running valid ids (C12)', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'mommy', removedScope: 'user' },
    });

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['weird:foo', 'user:mommy']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', 'mommy', {
      scope: 'user',
    });
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain(
      '❌ Alias ID: weird:fo… — Could not resolve the full alias on this page — please refresh and try again.'
    );
    expect(resultEmbed.description).toContain('✅ @mommy');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('logs error and skips followUp when ackUpdate rejects before the interaction is deferred (C7)', async () => {
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });
    vi.mocked(interaction.deferUpdate).mockRejectedValueOnce(new Error('Unknown interaction'));

    await handleAliasBatchConfirm(interaction);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: 'user-1' }),
      'Error preparing alias batch confirm'
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('catches a thrown fetchAliasRows rejection, logs error, and sends a transient followUp when deferred (C11)', async () => {
    mockUserClient.listMyAliases.mockRejectedValueOnce(new Error('socket hang up'));
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: 'user-1' }),
      'Error preparing alias batch confirm'
    );
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
      })
    );
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('catches and logs warn when both prep and the error-path followUp reject (C11b)', async () => {
    clientsForMock.mockImplementationOnce(() => {
      throw new Error('clientsFor exploded');
    });
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });
    vi.mocked(interaction.followUp).mockRejectedValueOnce(new Error('followUp exploded'));

    await handleAliasBatchConfirm(interaction);

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: 'user-1' }),
      'Error preparing alias batch confirm'
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: 'user-1' }),
      'Alias batch confirm error followUp failed'
    );
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('refuses with validation copy when the confirm footer exceeds MAX_BATCH_FOOTER_LENGTH', async () => {
    const overBudgetFooter = 'user:a\n'.repeat(Math.ceil(MAX_BATCH_FOOTER_LENGTH / 6) + 10);
    expect(overBudgetFooter.length).toBeGreaterThan(MAX_BATCH_FOOTER_LENGTH);
    const interaction = createButtonInteraction({
      footerText: overBudgetFooter,
    });

    await handleAliasBatchConfirm(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(SELECTION_TOO_LARGE_COPY),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('skips deferUpdate and still executes when called with interaction.deferred = true', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'mommy', removedScope: 'user' },
    });
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
      deferred: true,
    });

    await handleAliasBatchConfirm(interaction);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @mommy');
  });
});

describe('C5 — boundary and below-boundary resolution across truncated vs untruncated fetches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: mockUserClient });
  });

  it('reports already gone and makes NO removal call when a >=92-char alias key misses an untruncated single-character fetch (C2b)', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(SELECT_ALIAS_KEY_LENGTH);

    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([], false));

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds([`user:${truncatedKey}`]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain(`◻️ @${truncatedKey} — already gone`);
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('reports FAILED with a resolution reason and makes NO removal call when a >=92-char alias key misses a truncated single-character fetch (C3b)', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(SELECT_ALIAS_KEY_LENGTH);

    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([], true));

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds([`user:${truncatedKey}`]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌');
    expect(resultEmbed.description).toContain('resolve');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('resolves the full >92-char alias when the row IS present on the fetched page', async () => {
    const longAlias = `${'b'.repeat(SELECT_ALIAS_KEY_LENGTH)}-tail-suffix`;
    const longRow = makeAliasRow({
      alias: longAlias,
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([longRow]));
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: longAlias, removedScope: 'user' },
    });

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds([formatAliasSelectValue(longRow)]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', longAlias, {
      scope: 'user',
    });
  });

  it('resolves a boundary-length key that matches a single row only case-insensitively to that row canonical alias (C12)', async () => {
    const canonicalAlias = `${'b'.repeat(SELECT_ALIAS_KEY_LENGTH)}-tail`;
    const upperKey = 'B'.repeat(SELECT_ALIAS_KEY_LENGTH);
    const longRow = makeAliasRow({
      alias: canonicalAlias,
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([longRow], false));
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: canonicalAlias, removedScope: 'user' },
    });

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds([`user:${upperKey}`]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', canonicalAlias, {
      scope: 'user',
    });
  });

  it('reports already gone without calling removePersonalityAlias when a <92-char alias misses an untruncated single-character fetch (C4)', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([], false));

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds(['user:untruncated-alias']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️ @untruncated-alias — already gone');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('falls back to coords.query + aliasKey and succeeds when a <92-char alias misses a truncated single-character fetch and gateway returns 200 (C5)', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([], true));
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'untruncated-alias', removedScope: 'user' },
    });

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds(['user:untruncated-alias']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith(
      'lilith',
      'untruncated-alias',
      { scope: 'user' }
    );
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ @untruncated-alias');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });

  it('falls back to coords.query + aliasKey and reports FAILED with neutral copy when a <92-char alias misses a truncated single-character fetch and gateway returns 404 (C5b)', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([], true));
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Alias not found',
    });

    const singleCharConfirmId = buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', 'lilith');
    const interaction = createButtonInteraction({
      customId: singleCharConfirmId,
      footerText: encodeAliasBatchFooterIds(['user:untruncated-alias']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith(
      'lilith',
      'untruncated-alias',
      { scope: 'user' }
    );
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain(
      '❌ @untruncated-alias — Character or alias not found.'
    );
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('reports already gone without calling removePersonalityAlias when an untruncated alias misses the my-aliases fetch', async () => {
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([]));

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:untruncated-alias']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️ @untruncated-alias — already gone');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('reports FAILED with a resolution reason and makes NO removal call when an untruncated alias misses a truncated my-aliases fetch', async () => {
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([], true));

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:untruncated-alias']),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌ @untruncated-alias');
    expect(resultEmbed.description).toContain('resolve');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('reports already gone and makes NO removal call when a >=92-char alias misses an untruncated my-aliases fetch (C2)', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(SELECT_ALIAS_KEY_LENGTH);

    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([], false));

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds([`user:${truncatedKey}`]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain(`◻️ @${truncatedKey} — already gone`);
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('reports FAILED with a resolution reason and makes NO removal call when a >=92-char alias misses a truncated my-aliases fetch (C3)', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(SELECT_ALIAS_KEY_LENGTH);

    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([], true));

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds([`user:${truncatedKey}`]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌');
    expect(resultEmbed.description).toContain('resolve');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });
});

describe('boundary-key multi-match fails closed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: mockUserClient });
  });

  it('reports FAILED with the resolution copy and makes NO removal call when a 92-char key prefix-matches two same-scope rows', async () => {
    const sharedPrefix = 'p'.repeat(SELECT_ALIAS_KEY_LENGTH);
    const rowA = makeAliasRow({
      alias: `${sharedPrefix}-alpha`,
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    const rowB = makeAliasRow({
      alias: `${sharedPrefix}-beta`,
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    // Both rows format to the SAME 92-char select value, so the picked id
    // matches both — resolution must refuse rather than remove whichever
    // row scans first.
    expect(formatAliasSelectValue(rowA)).toBe(formatAliasSelectValue(rowB));
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([rowA, rowB]));

    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds([formatAliasSelectValue(rowA)]),
    });

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalledWith('lilith', rowA.alias, {
      scope: 'user',
    });
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalledWith('lilith', rowB.alias, {
      scope: 'user',
    });
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌');
    expect(resultEmbed.description).toContain('resolve');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });
});

describe('handleAliasBatchConfirm — survival ladder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: mockUserClient });
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('falls back to counts followUp when both editReply attempts after mutations reject', async () => {
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'mommy', removedScope: 'user' },
    });
    const interaction = createButtonInteraction({
      footerText: encodeAliasBatchFooterIds(['user:mommy']),
    });
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'))
      .mockRejectedValueOnce(new Error('Unknown Message'));

    await handleAliasBatchConfirm(interaction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1 succeeded'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });
});
