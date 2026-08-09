/**
 * Tests for /chime-in (top-level character summon command surface)
 *
 * The turn logic itself is covered by services/character/characterTurn.test.ts
 * and services/character/chimeInTag.test.ts; this file pins the command wiring:
 * definition shape, the character-vs-tag XOR and its dispatch, and the
 * two-handler autocomplete chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutocompleteInteraction } from 'discord.js';
import type {
  DeferredCommandContext,
  SafeCommandContext,
} from '../../utils/commandContext/types.js';

vi.mock('../../services/character/characterTurn.js', () => ({
  handleChimeIn: vi.fn().mockResolvedValue(undefined),
}));

const mockRunTagChimeIn = vi.fn();
vi.mock('../../services/character/chimeInTag.js', async importActual => {
  const actual = await importActual<typeof import('../../services/character/chimeInTag.js')>();
  return {
    ...actual,
    runTagChimeIn: (...args: unknown[]) => mockRunTagChimeIn(...args),
  };
});

const mockHandlePersonalityAutocomplete = vi.fn();
const mockHandleTagAutocomplete = vi.fn();
vi.mock('../../utils/autocomplete/index.js', () => ({
  handlePersonalityAutocomplete: (...args: unknown[]) => mockHandlePersonalityAutocomplete(...args),
  handleTagAutocomplete: (...args: unknown[]) => mockHandleTagAutocomplete(...args),
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

import chimeInCommand from './index.js';
import { handleChimeIn } from '../../services/character/characterTurn.js';

/**
 * A context whose interaction answers the typed-option readers. The generated
 * `chimeInOptions` reads through `interaction.options.get*`, so the stub
 * answers by option name.
 */
const makeContext = (
  values: { character?: string | null; tag?: string | null; incognito?: boolean | null } = {}
): SafeCommandContext => {
  const resolved = {
    character: values.character ?? null,
    tag: values.tag ?? null,
    incognito: values.incognito ?? null,
  };
  return {
    interaction: {
      options: {
        getString: (name: string) => resolved[name as 'character' | 'tag'] ?? null,
        getBoolean: () => resolved.incognito,
      },
    },
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as SafeCommandContext;
};

/**
 * `SafeCommandContext` is the union across deferral modes, and only the
 * deferred arm has `editReply` — narrow to that arm for the assertions.
 */
const editReplyOf = (context: SafeCommandContext) => (context as DeferredCommandContext).editReply;

describe('/chime-in command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlePersonalityAutocomplete.mockResolvedValue(true);
    mockHandleTagAutocomplete.mockResolvedValue(true);
    mockRunTagChimeIn.mockResolvedValue(undefined);
  });

  describe('command definition', () => {
    it('is named chime-in and defers ephemerally', () => {
      expect(chimeInCommand.data.name).toBe('chime-in');
      expect(chimeInCommand.deferralMode).toBe('ephemeral');
    });

    it('declares character and tag as optional selectors, both autocompleted', () => {
      const json = chimeInCommand.data.toJSON();
      const byName = new Map(json.options?.map(opt => [opt.name, opt]));

      // Discord has no native XOR and requires required options first, so both
      // selectors are optional and the exclusivity is enforced at runtime.
      expect(byName.get('character')?.required).not.toBe(true);
      expect(byName.get('tag')?.required).not.toBe(true);
      expect(byName.get('character')).toMatchObject({ autocomplete: true });
      expect(byName.get('tag')).toMatchObject({ autocomplete: true });
    });

    it('keeps incognito optional', () => {
      const json = chimeInCommand.data.toJSON();
      const byName = new Map(json.options?.map(opt => [opt.name, opt]));
      expect(byName.get('incognito')?.required).not.toBe(true);
    });
  });

  describe('execute — selector XOR', () => {
    it('routes a character to the single-turn engine, passing the slug down', async () => {
      const context = makeContext({ character: 'seraphina' });

      await chimeInCommand.execute(context);

      // Seam assertion: the slug crosses as an ARGUMENT, which is what stops a
      // null selector from falling through to a random pick inside the engine.
      expect(handleChimeIn).toHaveBeenCalledWith(context, 'seraphina');
      expect(mockRunTagChimeIn).not.toHaveBeenCalled();
    });

    it('routes a tag to the fan-out, forwarding the incognito option', async () => {
      const context = makeContext({ tag: 'fantasy', incognito: false });

      await chimeInCommand.execute(context);

      expect(mockRunTagChimeIn).toHaveBeenCalledWith(context, {
        tag: 'fantasy',
        incognitoOption: false,
      });
      expect(handleChimeIn).not.toHaveBeenCalled();
    });

    it('rejects both selectors at once', async () => {
      const context = makeContext({ character: 'seraphina', tag: 'fantasy' });

      await chimeInCommand.execute(context);

      expect(handleChimeIn).not.toHaveBeenCalled();
      expect(mockRunTagChimeIn).not.toHaveBeenCalled();
      expect(editReplyOf(context)).toHaveBeenCalledWith({
        content: expect.stringContaining('not both'),
      });
    });

    it('rejects neither selector', async () => {
      const context = makeContext();

      await chimeInCommand.execute(context);

      expect(handleChimeIn).not.toHaveBeenCalled();
      expect(mockRunTagChimeIn).not.toHaveBeenCalled();
      expect(editReplyOf(context)).toHaveBeenCalledWith({
        content: expect.stringContaining('not neither'),
      });
    });
  });

  describe('autocomplete', () => {
    const makeInteraction = (focusedName: string): AutocompleteInteraction =>
      ({
        user: { id: 'user-123' },
        options: { getFocused: vi.fn().mockReturnValue({ name: focusedName, value: '' }) },
        respond: vi.fn().mockResolvedValue(undefined),
        responded: false,
      }) as unknown as AutocompleteInteraction;

    it('offers the full accessible pool for character (not owner-scoped)', async () => {
      await chimeInCommand.autocomplete!(makeInteraction('character'));

      expect(mockHandlePersonalityAutocomplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ optionName: 'character', ownedOnly: false })
      );
      expect(mockHandleTagAutocomplete).not.toHaveBeenCalled();
    });

    it('falls through to the tag handler when character declines', async () => {
      mockHandlePersonalityAutocomplete.mockResolvedValue(false);

      await chimeInCommand.autocomplete!(makeInteraction('tag'));

      expect(mockHandleTagAutocomplete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ optionName: 'tag' })
      );
    });

    it('responds with an empty list when neither handler claims the option', async () => {
      mockHandlePersonalityAutocomplete.mockResolvedValue(false);
      mockHandleTagAutocomplete.mockResolvedValue(false);
      const interaction = makeInteraction('incognito');

      await chimeInCommand.autocomplete!(interaction);

      expect(interaction.respond).toHaveBeenCalledWith([]);
    });
  });
});
