/**
 * Tests for the foreign-application interaction guard.
 *
 * The log-shape tests use a customId whose full string differs from its
 * prefix, so a raw-customId leak in the warn fields cannot pass trivially.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BaseInteraction } from 'discord.js';
import { isForeignInteraction } from './foreignInteraction.js';

const mockWarn = vi.fn();
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: (...args: unknown[]) => mockWarn(...args),
      error: vi.fn(),
    }),
  };
});

const OWN_APPLICATION_ID = '1111111111111111111';
const FOREIGN_APPLICATION_ID = '2222222222222222222';
const RAW_CUSTOM_ID = 'shapes::import-confirm::full';

interface FamilyFixture {
  family: string;
  /** The one discord.js type guard this fixture reports true */
  guard: string;
  /** Expected `interactionType` log field */
  interactionType: string;
  customId?: string;
}

const FAMILY_FIXTURES: FamilyFixture[] = [
  {
    family: 'chat input',
    guard: 'isChatInputCommand',
    interactionType: 'chat_input',
  },
  {
    family: 'message context menu',
    guard: 'isMessageContextMenuCommand',
    interactionType: 'message_context_menu',
  },
  {
    family: 'modal submit',
    guard: 'isModalSubmit',
    interactionType: 'modal_submit',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'autocomplete',
    guard: 'isAutocomplete',
    interactionType: 'autocomplete',
  },
  {
    family: 'string select menu',
    guard: 'isStringSelectMenu',
    interactionType: 'string_select_menu',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'user select menu',
    guard: 'isUserSelectMenu',
    interactionType: 'user_select_menu',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'role select menu',
    guard: 'isRoleSelectMenu',
    interactionType: 'role_select_menu',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'channel select menu',
    guard: 'isChannelSelectMenu',
    interactionType: 'channel_select_menu',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'mentionable select menu',
    guard: 'isMentionableSelectMenu',
    interactionType: 'mentionable_select_menu',
    customId: RAW_CUSTOM_ID,
  },
  {
    family: 'button',
    guard: 'isButton',
    interactionType: 'button',
    customId: RAW_CUSTOM_ID,
  },
];

function makeInteraction(
  fx: { guard: string; customId?: string },
  applicationId: string,
  clientApplicationId: string | undefined
): BaseInteraction {
  return {
    applicationId,
    customId: fx.customId,
    client: {
      application: clientApplicationId === undefined ? null : { id: clientApplicationId },
    },
    isChatInputCommand: () => fx.guard === 'isChatInputCommand',
    isMessageContextMenuCommand: () => fx.guard === 'isMessageContextMenuCommand',
    isModalSubmit: () => fx.guard === 'isModalSubmit',
    isAutocomplete: () => fx.guard === 'isAutocomplete',
    isStringSelectMenu: () => fx.guard === 'isStringSelectMenu',
    isUserSelectMenu: () => fx.guard === 'isUserSelectMenu',
    isRoleSelectMenu: () => fx.guard === 'isRoleSelectMenu',
    isChannelSelectMenu: () => fx.guard === 'isChannelSelectMenu',
    isMentionableSelectMenu: () => fx.guard === 'isMentionableSelectMenu',
    isButton: () => fx.guard === 'isButton',
  } as unknown as BaseInteraction;
}

describe('isForeignInteraction', () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it.each(FAMILY_FIXTURES)('$family: foreign applicationId → true', fx => {
    const interaction = makeInteraction(fx, FOREIGN_APPLICATION_ID, OWN_APPLICATION_ID);
    expect(isForeignInteraction(interaction)).toBe(true);
  });

  it.each(FAMILY_FIXTURES)('$family: own applicationId → false, no log', fx => {
    const interaction = makeInteraction(fx, OWN_APPLICATION_ID, OWN_APPLICATION_ID);
    expect(isForeignInteraction(interaction)).toBe(false);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('fails open when the client application is not yet populated', () => {
    const interaction = makeInteraction(FAMILY_FIXTURES[0], FOREIGN_APPLICATION_ID, undefined);
    expect(isForeignInteraction(interaction)).toBe(false);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it.each(FAMILY_FIXTURES)('$family: logs the family-specific interactionType', fx => {
    const interaction = makeInteraction(fx, FOREIGN_APPLICATION_ID, OWN_APPLICATION_ID);
    expect(isForeignInteraction(interaction)).toBe(true);

    expect(mockWarn).toHaveBeenCalledTimes(1);
    const fields = mockWarn.mock.calls[0][0] as Record<string, unknown>;
    expect(fields.interactionType).toBe(fx.interactionType);
  });

  it('logs unknown for an interaction matching no known family', () => {
    const interaction = makeInteraction(
      { guard: 'none' },
      FOREIGN_APPLICATION_ID,
      OWN_APPLICATION_ID
    );
    expect(isForeignInteraction(interaction)).toBe(true);

    const fields = mockWarn.mock.calls[0][0] as Record<string, unknown>;
    expect(fields.interactionType).toBe('unknown');
    expect('customIdPrefix' in fields).toBe(false);
  });

  it.each(FAMILY_FIXTURES.filter(fx => fx.customId !== undefined))(
    '$family: logs the parsed prefix, never the raw customId',
    fx => {
      const interaction = makeInteraction(fx, FOREIGN_APPLICATION_ID, OWN_APPLICATION_ID);
      expect(isForeignInteraction(interaction)).toBe(true);

      expect(mockWarn).toHaveBeenCalledTimes(1);
      const [fields, message] = mockWarn.mock.calls[0] as [Record<string, unknown>, string];
      expect(message).toBe('Ignoring interaction addressed to another application');
      expect(fields.foreignApplicationId).toBe(FOREIGN_APPLICATION_ID);
      expect(fields.interactionType).toBe(fx.interactionType);
      expect(fields.customIdPrefix).toBe('shapes');
      for (const value of Object.values(fields)) {
        expect(value).not.toBe(RAW_CUSTOM_ID);
      }
    }
  );

  it('omits the customIdPrefix field when the customId has no delimiter', () => {
    const interaction = makeInteraction(
      { guard: 'isButton', customId: 'no-delimiter-id' },
      FOREIGN_APPLICATION_ID,
      OWN_APPLICATION_ID
    );
    expect(isForeignInteraction(interaction)).toBe(true);

    const fields = mockWarn.mock.calls[0][0] as Record<string, unknown>;
    expect('customIdPrefix' in fields).toBe(false);
    for (const value of Object.values(fields)) {
      expect(value).not.toBe('no-delimiter-id');
    }
  });

  it('checks the guards in declared order (chat input beats modal submit)', () => {
    const interaction = {
      applicationId: FOREIGN_APPLICATION_ID,
      customId: RAW_CUSTOM_ID,
      client: { application: { id: OWN_APPLICATION_ID } },
      isChatInputCommand: () => true,
      isMessageContextMenuCommand: () => false,
      isModalSubmit: () => true,
      isAutocomplete: () => false,
      isStringSelectMenu: () => false,
      isUserSelectMenu: () => false,
      isRoleSelectMenu: () => false,
      isChannelSelectMenu: () => false,
      isMentionableSelectMenu: () => false,
      isButton: () => false,
    } as unknown as BaseInteraction;

    expect(isForeignInteraction(interaction)).toBe(true);

    const fields = mockWarn.mock.calls[0][0] as Record<string, unknown>;
    expect(fields.interactionType).toBe('chat_input');
  });
});
