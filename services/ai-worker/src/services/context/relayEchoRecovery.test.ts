import { describe, it, expect, vi } from 'vitest';
import { MessageRole, type ConversationMessage } from '@tzurot/common-types';
import { recoverRelayEchoIdentities } from './relayEchoRecovery.js';

function relayEcho(over: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    role: MessageRole.User,
    content: 'poke',
    personaName: 'Lila', // recovered bot-side from the **Lila:** prefix
    personaId: '', // bot-authored → resolver stripped it
    discordUsername: 'Rotzot · bot', // the bot's webhook name
    discordMessageId: ['d-relay'],
    ...over,
  } as ConversationMessage;
}

describe('recoverRelayEchoIdentities', () => {
  it('recovers the human identity for an unresolved relay-echo', async () => {
    const messages = [relayEcho()];
    const dataSource = {
      getUserIdentitiesByDiscordIds: vi
        .fn()
        .mockResolvedValue(
          new Map([
            [
              'd-relay',
              { personaId: 'persona-uuid', personaName: 'Lila', discordUsername: 'lbds137' },
            ],
          ])
        ),
    };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(messages[0].personaId).toBe('persona-uuid');
    expect(messages[0].personaName).toBe('Lila');
    expect(messages[0].discordUsername).toBe('lbds137'); // unified with direct messages
    expect(dataSource.getUserIdentitiesByDiscordIds).toHaveBeenCalledWith(['d-relay']);
  });

  it('treats a raw discord: placeholder (resolver skipped) as a candidate', async () => {
    const messages = [relayEcho({ personaId: 'discord:9999', discordMessageId: ['d-raw'] })];
    const dataSource = {
      getUserIdentitiesByDiscordIds: vi
        .fn()
        .mockResolvedValue(
          new Map([['d-raw', { personaId: 'p', personaName: 'Lila', discordUsername: 'lbds137' }]])
        ),
    };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(messages[0].discordUsername).toBe('lbds137');
  });

  it('leaves the message untouched when no persisted row matches (graceful fallback)', async () => {
    const messages = [relayEcho({ discordMessageId: ['d-gone'] })];
    const dataSource = { getUserIdentitiesByDiscordIds: vi.fn().mockResolvedValue(new Map()) };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(messages[0].discordUsername).toBe('Rotzot · bot');
    expect(messages[0].personaId).toBe('');
  });

  it('skips messages that already carry a resolved personaId (no query at all)', async () => {
    const messages = [relayEcho({ personaId: 'real-uuid', discordUsername: 'lbds137' })];
    const dataSource = { getUserIdentitiesByDiscordIds: vi.fn().mockResolvedValue(new Map()) };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(dataSource.getUserIdentitiesByDiscordIds).not.toHaveBeenCalled();
    expect(messages[0].personaId).toBe('real-uuid');
  });

  it('does not touch assistant messages', async () => {
    const messages = [relayEcho({ role: MessageRole.Assistant, discordMessageId: ['d-a'] })];
    const dataSource = { getUserIdentitiesByDiscordIds: vi.fn().mockResolvedValue(new Map()) };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(dataSource.getUserIdentitiesByDiscordIds).not.toHaveBeenCalled();
  });
});
