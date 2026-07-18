/**
 * Tests for the alias browse pilot: render modes, the first in-place filter
 * toggle, and the select → Tier-A confirm → remove → re-render loop with
 * footer-carried state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ButtonInteraction, StringSelectMenuInteraction, APIEmbed } from 'discord.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const mockUserClient = {
  listPersonalityAliases: vi.fn(),
  listMyAliases: vi.fn(),
  addPersonalityAlias: vi.fn(),
  removePersonalityAlias: vi.fn(),
};

vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: () => ({ userClient: mockUserClient }),
}));

import { aliasComponentRouter } from './aliasBrowse.js';
// The slash entry is the natural way to drive a full render in tests.
import { handleAliasBrowse } from './alias.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const CREATED_AT = '2026-07-18T00:00:00.000Z';

function myAliasesResponse(): unknown {
  return {
    ok: true,
    data: {
      aliases: [
        {
          alias: 'mommy',
          scope: 'user',
          personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
          shadowed: false,
          createdAt: CREATED_AT,
        },
        {
          alias: 'lila',
          scope: 'global',
          personality: { id: 'p-2', name: 'Lila Elyona', slug: 'lila-elyona' },
          shadowed: true,
          createdAt: CREATED_AT,
        },
      ],
      truncated: false,
    },
  };
}

function characterAliasesResponse(): unknown {
  return {
    ok: true,
    data: {
      aliases: [
        { alias: 'lila', scope: 'global', createdAt: CREATED_AT },
        { alias: 'mine', scope: 'user', createdAt: CREATED_AT },
      ],
      truncated: false,
    },
  };
}

interface CapturedRender {
  content?: string;
  embeds?: { toJSON: () => APIEmbed }[];
  components?: { toJSON: () => { components: { custom_id?: string; label?: string }[] } }[];
}

function lastRender(editReply: ReturnType<typeof vi.fn>): CapturedRender {
  const calls = editReply.mock.calls;
  return calls[calls.length - 1][0] as CapturedRender;
}

function embedJson(render: CapturedRender): APIEmbed {
  return render.embeds![0].toJSON();
}

/** Every custom_id across all component rows of a render. */
function componentIds(render: CapturedRender): string[] {
  return (render.components ?? []).flatMap(row =>
    row.toJSON().components.map(component => component.custom_id ?? '')
  );
}

function makeContext(options: Record<string, string | null>): DeferredCommandContext {
  return {
    interaction: {
      options: {
        getString: vi.fn((name: string, required?: boolean) => {
          const value = options[name] ?? null;
          if (required === true && value === null) {
            throw new Error(`required option ${name} missing`);
          }
          return value;
        }),
      },
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as DeferredCommandContext;
}

function makeButtonInteraction(customId: string, footerText?: string): ButtonInteraction {
  return {
    customId,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    message: {
      embeds: footerText === undefined ? [] : [{ footer: { text: footerText } }],
    },
  } as unknown as ButtonInteraction;
}

function makeSelectInteraction(customId: string, value: string): StringSelectMenuInteraction {
  return {
    customId,
    values: [value],
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
}

describe('alias browse pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesResponse());
    mockUserClient.listPersonalityAliases.mockResolvedValue(characterAliasesResponse());
  });

  describe('handleAliasBrowse — my-aliases mode (no character)', () => {
    it('renders scope + shadowed badges, character metadata, and the shadowed legend', async () => {
      const context = makeContext({ character: null });

      await handleAliasBrowse(context);

      expect(mockUserClient.listMyAliases).toHaveBeenCalledTimes(1);
      expect(mockUserClient.listPersonalityAliases).not.toHaveBeenCalled();
      const embed = embedJson(lastRender(vi.mocked(context.editReply)));
      expect(embed.title).toBe('🏷️ Aliases');
      expect(embed.description).toContain('🔒 **@mommy**');
      // The shadowed global row carries BOTH its scope badge and ⚠️.
      expect(embed.description).toContain('🌐⚠️ **@lila**');
      // Metadata line carries the character context in my-mode.
      expect(embed.description).toContain('└ Lilith (lilith)');
      expect(embed.footer?.text).toContain('Shadowed ⚠️');
    });

    it('ships the filter toggle as a browse-coordinate button with only the filter advanced', async () => {
      const context = makeContext({ character: null });

      await handleAliasBrowse(context);

      const ids = componentIds(lastRender(vi.mocked(context.editReply)));
      // Current filter 'all' → the toggle points at 'mine', page reset to 0.
      expect(ids).toContain('character-alias::browse::0::mine::');
    });

    it('renders the designed empty state with the add CTA', async () => {
      mockUserClient.listMyAliases.mockResolvedValue({
        ok: true,
        data: { aliases: [], truncated: false },
      });
      const context = makeContext({ character: null });

      await handleAliasBrowse(context);

      const render = lastRender(vi.mocked(context.editReply));
      expect(embedJson(render).description).toContain('/character alias add');
      // No rows → no select menu; pagination + toggle row remains.
      expect(componentIds(render).some(id => id.includes('browse-select'))).toBe(false);
    });
  });

  describe('handleAliasBrowse — per-character mode', () => {
    it('fetches the character΄s list and carries the slug as the query coordinate', async () => {
      const context = makeContext({ character: 'lila-elyona' });

      await handleAliasBrowse(context);

      expect(mockUserClient.listPersonalityAliases).toHaveBeenCalledWith('lila-elyona');
      const render = lastRender(vi.mocked(context.editReply));
      const ids = componentIds(render);
      // Coordinates (incl. the select's) carry the slug as the query segment.
      expect(ids.some(id => id.endsWith('::lila-elyona'))).toBe(true);
      // Per-character mode has no shadow data — legend omits ⚠️.
      expect(embedJson(render).footer?.text).not.toContain('Shadowed');
    });
  });

  describe('select → confirm → remove loop', () => {
    it('select renders a Tier-A confirm with state in the footer (Cancel before Remove)', async () => {
      const interaction = makeSelectInteraction(
        'character-alias::browse-select::0::all::',
        'user:mommy'
      );

      await aliasComponentRouter.handleSelectMenu(interaction);

      expect(vi.mocked(interaction.deferUpdate)).toHaveBeenCalledTimes(1);
      const render = lastRender(vi.mocked(interaction.editReply));
      const embed = embedJson(render);
      // Machine state: scope, slug, alias — newline-delimited, alias LAST.
      expect(embed.footer?.text).toBe('user\nlilith\nmommy');
      expect(embed.description).toContain('`@mommy`');
      expect(embed.description).toContain('only affects you');
      const buttons = render.components![0].toJSON().components;
      // Factory-owned order: Cancel (rm-no) precedes the Danger confirm.
      expect(buttons[0].custom_id).toBe('character-alias::rm-no::0::all::');
      expect(buttons[1].custom_id).toBe('character-alias::rm-yes::0::all::');
    });

    it('re-renders the browse when the selected row vanished (stale click)', async () => {
      const interaction = makeSelectInteraction(
        'character-alias::browse-select::0::all::',
        'user:ghost-alias'
      );

      await aliasComponentRouter.handleSelectMenu(interaction);

      const render = lastRender(vi.mocked(interaction.editReply));
      // Back to the list, not a confirm screen (no footer state).
      expect(embedJson(render).title).toBe('🏷️ Aliases');
    });

    it('confirm parses the footer, removes with the EXPLICIT tier, and re-renders with a banner', async () => {
      mockUserClient.removePersonalityAlias.mockResolvedValue({
        ok: true,
        data: { removedAlias: 'mommy', removedScope: 'user' },
      });
      const interaction = makeButtonInteraction(
        'character-alias::rm-yes::0::all::',
        'user\nlilith\nmommy'
      );

      await aliasComponentRouter.handleButton(interaction);

      // Seam: slug from the footer, scope passed explicitly — never defaulted.
      expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', 'mommy', {
        scope: 'user',
      });
      const render = lastRender(vi.mocked(interaction.editReply));
      const embed = embedJson(render);
      expect(embed.title).toBe('🏷️ Aliases');
      expect(embed.description).toContain('Removed alias');
    });

    it('preserves alias text containing newlines through the footer round-trip', async () => {
      mockUserClient.removePersonalityAlias.mockResolvedValue({
        ok: true,
        data: { removedAlias: 'odd\nalias', removedScope: 'user' },
      });
      const interaction = makeButtonInteraction(
        'character-alias::rm-yes::0::all::',
        'user\nlilith\nodd\nalias'
      );

      await aliasComponentRouter.handleButton(interaction);

      // Alias is everything after the SECOND newline — verbatim.
      expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledWith('lilith', 'odd\nalias', {
        scope: 'user',
      });
    });

    it('surfaces a removal failure ephemerally and returns to the browse', async () => {
      mockUserClient.removePersonalityAlias.mockResolvedValue({
        ok: false,
        status: 404,
        error: 'Alias not found',
      });
      const interaction = makeButtonInteraction(
        'character-alias::rm-yes::0::all::',
        'user\nlilith\nmommy'
      );

      await aliasComponentRouter.handleButton(interaction);

      expect(vi.mocked(interaction.followUp)).toHaveBeenCalledTimes(1);
      expect(embedJson(lastRender(vi.mocked(interaction.editReply))).title).toBe('🏷️ Aliases');
    });

    it('cancel returns to the browse at the carried coordinates without removing', async () => {
      const interaction = makeButtonInteraction('character-alias::rm-no::2::mine::');
      mockUserClient.listMyAliases.mockResolvedValue(myAliasesResponse());

      await aliasComponentRouter.handleButton(interaction);

      expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
      expect(embedJson(lastRender(vi.mocked(interaction.editReply))).title).toBe('🏷️ Aliases');
    });
  });

  describe('filter toggle + pagination handling', () => {
    it('a toggle/pagination click re-renders at the parsed coordinates', async () => {
      const interaction = makeButtonInteraction('character-alias::browse::0::global::');

      await aliasComponentRouter.handleButton(interaction);

      expect(vi.mocked(interaction.deferUpdate)).toHaveBeenCalledTimes(1);
      const render = lastRender(vi.mocked(interaction.editReply));
      const embed = embedJson(render);
      // Global filter: only the global row remains.
      expect(embed.description).toContain('@lila');
      expect(embed.description).not.toContain('@mommy');
      // The toggle now points at 'all' (global → all).
      expect(componentIds(render)).toContain('character-alias::browse::0::all::');
    });
  });
});
