import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageFlags, type Interaction, type Message } from 'discord.js';
import {
  respondToInteractionDuringMaintenance,
  acknowledgeMessageDuringMaintenance,
  MAINTENANCE_USER_MESSAGE,
  MAINTENANCE_REACTION,
} from './maintenanceResponses.js';

describe('maintenanceResponses', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('respondToInteractionDuringMaintenance', () => {
    it('replies ephemerally to repliable interactions', async () => {
      const reply = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        isAutocomplete: () => false,
        isRepliable: () => true,
        reply,
      } as unknown as Interaction;

      await respondToInteractionDuringMaintenance(interaction);

      expect(reply).toHaveBeenCalledWith({
        content: MAINTENANCE_USER_MESSAGE,
        flags: MessageFlags.Ephemeral,
      });
    });

    it('responds to autocomplete with an empty choice list', async () => {
      const respond = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        isAutocomplete: () => true,
        respond,
      } as unknown as Interaction;

      await respondToInteractionDuringMaintenance(interaction);

      expect(respond).toHaveBeenCalledWith([]);
    });

    it('swallows reply failures (already-acked, missing perms)', async () => {
      const interaction = {
        isAutocomplete: () => false,
        isRepliable: () => true,
        reply: vi.fn().mockRejectedValue(new Error('Interaction already replied')),
      } as unknown as Interaction;

      await expect(respondToInteractionDuringMaintenance(interaction)).resolves.toBeUndefined();
    });
  });

  describe('acknowledgeMessageDuringMaintenance', () => {
    const clientUser = { id: 'bot-id' };

    function makeMessage(overrides: Record<string, unknown>): Message {
      return {
        id: 'msg-1',
        author: { bot: false },
        guild: {},
        client: { user: clientUser },
        mentions: { has: vi.fn().mockReturnValue(false) },
        reply: vi.fn().mockResolvedValue(undefined),
        react: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as Message;
    }

    it('replies with the maintenance notice in DMs', async () => {
      const message = makeMessage({ guild: null });

      await acknowledgeMessageDuringMaintenance(message);

      expect(message.reply).toHaveBeenCalledWith(MAINTENANCE_USER_MESSAGE);
      expect(message.react).not.toHaveBeenCalled();
    });

    it('reacts 🔧 to guild messages that mention the bot', async () => {
      const message = makeMessage({
        mentions: { has: vi.fn().mockReturnValue(true) },
      });

      await acknowledgeMessageDuringMaintenance(message);

      expect(message.react).toHaveBeenCalledWith(MAINTENANCE_REACTION);
      expect(message.reply).not.toHaveBeenCalled();
    });

    it('stays silent for guild messages that do not mention the bot', async () => {
      const message = makeMessage({});

      await acknowledgeMessageDuringMaintenance(message);

      expect(message.reply).not.toHaveBeenCalled();
      expect(message.react).not.toHaveBeenCalled();
    });

    it('never acknowledges bot/webhook authors', async () => {
      const message = makeMessage({ guild: null, author: { bot: true } });

      await acknowledgeMessageDuringMaintenance(message);

      expect(message.reply).not.toHaveBeenCalled();
    });

    it('swallows reaction failures (missing permissions)', async () => {
      const message = makeMessage({
        mentions: { has: vi.fn().mockReturnValue(true) },
        react: vi.fn().mockRejectedValue(new Error('Missing Permissions')),
      });

      await expect(acknowledgeMessageDuringMaintenance(message)).resolves.toBeUndefined();
    });
  });
});
