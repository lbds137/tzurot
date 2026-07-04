import { describe, it, expect, vi } from 'vitest';
import { MessageRole } from '@tzurot/common-types/constants/message';
import { type ConversationMessage } from '@tzurot/common-types/types/conversationMessage';
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

  it('scans past a non-matching id to a later match (multi-part reply)', async () => {
    // A long reply spans several Discord messages, so discordMessageId can hold
    // multiple ids; the loop must skip a non-matching one and recover from a later one.
    const messages = [relayEcho({ discordMessageId: ['d-miss', 'd-hit'] })];
    const dataSource = {
      getUserIdentitiesByDiscordIds: vi
        .fn()
        .mockResolvedValue(
          new Map([
            [
              'd-hit',
              { personaId: 'persona-uuid', personaName: 'Lila', discordUsername: 'lbds137' },
            ],
          ])
        ),
    };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(messages[0].personaId).toBe('persona-uuid');
    expect(messages[0].personaName).toBe('Lila');
    expect(messages[0].discordUsername).toBe('lbds137');
  });

  it('uses the FIRST matching id when several match (break wins)', async () => {
    const messages = [relayEcho({ discordMessageId: ['d-first', 'd-second'] })];
    const dataSource = {
      getUserIdentitiesByDiscordIds: vi.fn().mockResolvedValue(
        new Map([
          [
            'd-first',
            { personaId: 'first-uuid', personaName: 'Lila', discordUsername: 'first-user' },
          ],
          [
            'd-second',
            { personaId: 'second-uuid', personaName: 'Lila', discordUsername: 'second-user' },
          ],
        ])
      ),
    };

    await recoverRelayEchoIdentities(messages, dataSource);

    expect(messages[0].personaId).toBe('first-uuid');
    expect(messages[0].discordUsername).toBe('first-user');
  });
});
