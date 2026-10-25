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
  createButtonInteraction,
  editReplyEmbeds,
  makeAliasRow,
  mockUserClient,
  myAliasesPayload,
} from '../../test/mocks/aliasBatch.mock.js';
import { BATCH_CONFIRM_PREFIX, encodeAliasBatchFooterIds } from './aliasBatch.js';
import { handleAliasBatchConfirm } from './aliasBatchConfirm.js';
import {
  SELECT_ALIAS_KEY_LENGTH,
  buildRemoveCustomId,
  formatAliasSelectValue,
} from './aliasBrowseView.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/gatewayClients.js', async () => {
  const { mockUserClient } = await import('../../test/mocks/aliasBatch.mock.js');
  return { clientsFor: () => ({ userClient: mockUserClient }) };
});

describe('C1 — handleAliasBatchConfirm (partial failure & already-gone named, loop reaches all)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('reaches all 5 aliases when #2 returns a 404 envelope, naming #2 already gone and the other 4 succeeded (C1 404 envelope)', async () => {
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
    expect(resultEmbed.description).toContain('◻️ @lila — already gone');
    expect(resultEmbed.description).toContain('✅ @queen');
    expect(resultEmbed.description).toContain('✅ @boss');
    expect(resultEmbed.description).toContain('✅ @star');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });

  it('names every alias already gone and reports the WARNING colour when every removal returns a 404 envelope (C1 all-already-gone)', async () => {
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
    expect(resultEmbed.description).toContain('◻️ @mommy — already gone');
    expect(resultEmbed.description).toContain('◻️ @star — already gone');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
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
});

describe('C5 — no prefix deletes on truncated keys when a row misses post-pick fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports FAILED with a resolution reason and makes NO removal call when a >=92-char alias row misses the page fetch (C5)', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(92);

    // Post-pick page fetch returns empty (the long alias row vanished).
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([]));

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
    const longAlias = `${'b'.repeat(92)}-tail-suffix`;
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

  it('falls back to coords.query + aliasKey in single-character mode ONLY when aliasKey length < 92', async () => {
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesPayload([]));
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
    expect(resultEmbed.description).toContain('◻️ @untruncated-alias — already gone');
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

  it('reports FAILED with a resolution reason and makes NO removal call when a >=92-char alias misses the my-aliases fetch', async () => {
    const longAlias = 'a'.repeat(100);
    const truncatedKey = longAlias.slice(0, SELECT_ALIAS_KEY_LENGTH);
    expect(truncatedKey).toHaveLength(92);

    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload([]));

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
