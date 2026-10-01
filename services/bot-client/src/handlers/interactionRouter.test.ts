/**
 * Tests for the interaction routing body extracted from the entrypoint.
 *
 * The zero-ack set is the load-bearing suite: with a FOREIGN applicationId,
 * routeInteraction must resolve having touched no seam at all — removing the
 * isForeignInteraction guard line redden these tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Interaction } from 'discord.js';
import { routeInteraction, type InteractionRouterDeps } from './interactionRouter.js';

const mockHandleCommandWithContext = vi.fn().mockResolvedValue(undefined);
vi.mock('./commandDispatch.js', () => ({
  handleCommandWithContext: (...args: unknown[]) => mockHandleCommandWithContext(...args),
}));

const mockRespondToInteractionDuringMaintenance = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/maintenanceResponses.js', () => ({
  respondToInteractionDuringMaintenance: (...args: unknown[]) =>
    mockRespondToInteractionDuringMaintenance(...args),
}));

const mockStampUserActivity = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/gatewayServiceCalls.js', () => ({
  stampUserActivity: (...args: unknown[]) => mockStampUserActivity(...args),
}));

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: (id: string) => id === 'owner-id',
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const OWN_APPLICATION_ID = '1111111111111111111';
const FOREIGN_APPLICATION_ID = '2222222222222222222';

const FAMILY_FIXTURES = [
  { family: 'chat input', guard: 'isChatInputCommand', customId: undefined },
  {
    family: 'message context menu',
    guard: 'isMessageContextMenuCommand',
    customId: undefined,
  },
  {
    family: 'modal submit',
    guard: 'isModalSubmit',
    customId: 'shapes::import-confirm::full',
  },
  { family: 'autocomplete', guard: 'isAutocomplete', customId: undefined },
  {
    family: 'string select menu',
    guard: 'isStringSelectMenu',
    customId: 'shapes::import-confirm::full',
  },
  { family: 'button', guard: 'isButton', customId: 'shapes::import-confirm::full' },
] as const;

function makeInteraction(
  fx: { guard: string; customId?: string; commandName?: string },
  applicationId: string
): Interaction {
  return {
    applicationId,
    client: { application: { id: OWN_APPLICATION_ID } },
    commandName: fx.commandName ?? 'test',
    user: { id: 'user-1' },
    guildId: null,
    channelId: 'channel-1',
    channel: null,
    customId: fx.customId,
    isChatInputCommand: () => fx.guard === 'isChatInputCommand',
    isMessageContextMenuCommand: () => fx.guard === 'isMessageContextMenuCommand',
    isModalSubmit: () => fx.guard === 'isModalSubmit',
    isAutocomplete: () => fx.guard === 'isAutocomplete',
    isStringSelectMenu: () => fx.guard === 'isStringSelectMenu',
    isButton: () => fx.guard === 'isButton',
  } as unknown as Interaction;
}

/**
 * Fresh vi.fn() collaborator set per test. `deps` is what routeInteraction
 * consumes (cast to the structural interface, like the interaction mocks in
 * CommandHandler.test.ts); `raw` keeps the untyped vi.fn() handles so tests
 * can configure return values and assert calls without fighting the cast.
 */
function makeDeps(): {
  deps: InteractionRouterDeps;
  raw: {
    services: {
      dmCacheWarmer: { warm: ReturnType<typeof vi.fn> };
      denylistCache: {
        isBotDenied: ReturnType<typeof vi.fn>;
        isUserGuildDenied: ReturnType<typeof vi.fn>;
        isChannelDenied: ReturnType<typeof vi.fn>;
      };
      maintenanceFlag: { isActive: ReturnType<typeof vi.fn> };
    };
    commandHandler: {
      getCommand: ReturnType<typeof vi.fn>;
      handleContextMenuCommand: ReturnType<typeof vi.fn>;
      handleModalInteraction: ReturnType<typeof vi.fn>;
      handleAutocomplete: ReturnType<typeof vi.fn>;
      handleComponentInteraction: ReturnType<typeof vi.fn>;
    };
  };
} {
  const raw = {
    services: {
      dmCacheWarmer: { warm: vi.fn() },
      denylistCache: {
        isBotDenied: vi.fn().mockReturnValue(false),
        isUserGuildDenied: vi.fn().mockReturnValue(false),
        isChannelDenied: vi.fn().mockReturnValue(false),
      },
      maintenanceFlag: { isActive: vi.fn().mockResolvedValue(false) },
    },
    commandHandler: {
      getCommand: vi.fn(),
      handleContextMenuCommand: vi.fn().mockResolvedValue(undefined),
      handleModalInteraction: vi.fn().mockResolvedValue(undefined),
      handleAutocomplete: vi.fn().mockResolvedValue(undefined),
      handleComponentInteraction: vi.fn().mockResolvedValue(undefined),
    },
  };
  const deps = raw as unknown as InteractionRouterDeps;
  return { deps, raw };
}

describe('routeInteraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('foreign-application guard (the zero-ack set)', () => {
    it.each(FAMILY_FIXTURES)(
      'foreign $family interaction: resolves without warming, gating, or dispatching anything',
      async fx => {
        const { deps, raw } = makeDeps();

        await routeInteraction(deps, makeInteraction(fx, FOREIGN_APPLICATION_ID));

        expect(raw.services.dmCacheWarmer.warm).not.toHaveBeenCalled();
        expect(raw.services.denylistCache.isBotDenied).not.toHaveBeenCalled();
        expect(raw.services.maintenanceFlag.isActive).not.toHaveBeenCalled();
        expect(mockRespondToInteractionDuringMaintenance).not.toHaveBeenCalled();
        expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
        expect(raw.commandHandler.getCommand).not.toHaveBeenCalled();
        expect(raw.commandHandler.handleContextMenuCommand).not.toHaveBeenCalled();
        expect(raw.commandHandler.handleModalInteraction).not.toHaveBeenCalled();
        expect(raw.commandHandler.handleAutocomplete).not.toHaveBeenCalled();
        expect(raw.commandHandler.handleComponentInteraction).not.toHaveBeenCalled();
      }
    );

    it('foreign interaction during an active maintenance window: still zero ack', async () => {
      const { deps, raw } = makeDeps();
      raw.services.maintenanceFlag.isActive.mockResolvedValue(true);

      await routeInteraction(deps, makeInteraction(FAMILY_FIXTURES[0], FOREIGN_APPLICATION_ID));

      expect(raw.services.maintenanceFlag.isActive).not.toHaveBeenCalled();
      expect(mockRespondToInteractionDuringMaintenance).not.toHaveBeenCalled();
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
      expect(raw.services.dmCacheWarmer.warm).not.toHaveBeenCalled();
    });
  });

  describe('own-application fall-through (one case per intake family)', () => {
    it('chat input: dispatches via handleCommandWithContext with the looked-up command', async () => {
      const { deps, raw } = makeDeps();
      const sentinelCommand = { data: { name: 'test' }, execute: vi.fn() };
      raw.commandHandler.getCommand.mockReturnValue(sentinelCommand);
      const interaction = makeInteraction(
        { guard: 'isChatInputCommand', commandName: 'test' },
        OWN_APPLICATION_ID
      );

      await routeInteraction(deps, interaction);

      expect(raw.services.dmCacheWarmer.warm).toHaveBeenCalledWith(interaction.user);
      expect(raw.commandHandler.getCommand).toHaveBeenCalledWith('test');
      expect(mockHandleCommandWithContext).toHaveBeenCalledWith(interaction, sentinelCommand);
      expect(mockStampUserActivity).toHaveBeenCalledWith('user-1');
    });

    it('message context menu: handleContextMenuCommand', async () => {
      const { deps, raw } = makeDeps();
      const interaction = makeInteraction(
        { guard: 'isMessageContextMenuCommand' },
        OWN_APPLICATION_ID
      );

      await routeInteraction(deps, interaction);

      expect(raw.commandHandler.handleContextMenuCommand).toHaveBeenCalledWith(interaction);
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
    });

    it('modal submit: handleModalInteraction', async () => {
      const { deps, raw } = makeDeps();
      const interaction = makeInteraction({ guard: 'isModalSubmit' }, OWN_APPLICATION_ID);

      await routeInteraction(deps, interaction);

      expect(raw.commandHandler.handleModalInteraction).toHaveBeenCalledWith(interaction);
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
    });

    it('autocomplete: handleAutocomplete', async () => {
      const { deps, raw } = makeDeps();
      const interaction = makeInteraction({ guard: 'isAutocomplete' }, OWN_APPLICATION_ID);

      await routeInteraction(deps, interaction);

      expect(raw.commandHandler.handleAutocomplete).toHaveBeenCalledWith(interaction);
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
    });

    it.each([
      { family: 'string select menu', guard: 'isStringSelectMenu' },
      { family: 'button', guard: 'isButton' },
    ])('$family: handleComponentInteraction', async fx => {
      const { deps, raw } = makeDeps();
      const interaction = makeInteraction(fx, OWN_APPLICATION_ID);

      await routeInteraction(deps, interaction);

      expect(raw.commandHandler.handleComponentInteraction).toHaveBeenCalledWith(interaction);
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
    });
  });

  describe('moved-wiring regressions', () => {
    it('denylist-denied own interaction: silent return — no maintenance, no dispatch', async () => {
      const { deps, raw } = makeDeps();
      raw.services.denylistCache.isBotDenied.mockReturnValue(true);
      const interaction = makeInteraction({ guard: 'isChatInputCommand' }, OWN_APPLICATION_ID);

      await routeInteraction(deps, interaction);

      expect(raw.services.maintenanceFlag.isActive).not.toHaveBeenCalled();
      expect(mockRespondToInteractionDuringMaintenance).not.toHaveBeenCalled();
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
      expect(raw.commandHandler.handleComponentInteraction).not.toHaveBeenCalled();
      expect(mockStampUserActivity).not.toHaveBeenCalled();
    });

    it('own interaction during an active maintenance window: gets the maintenance reply, no dispatch', async () => {
      const { deps, raw } = makeDeps();
      raw.services.maintenanceFlag.isActive.mockResolvedValue(true);
      const interaction = makeInteraction({ guard: 'isChatInputCommand' }, OWN_APPLICATION_ID);

      await routeInteraction(deps, interaction);

      expect(mockRespondToInteractionDuringMaintenance).toHaveBeenCalledWith(interaction);
      expect(mockHandleCommandWithContext).not.toHaveBeenCalled();
      expect(raw.commandHandler.getCommand).not.toHaveBeenCalled();
      expect(mockStampUserActivity).not.toHaveBeenCalled();
    });
  });
});
