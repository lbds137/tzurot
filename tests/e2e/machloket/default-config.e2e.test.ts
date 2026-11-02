import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, Events } from 'discord.js';
import { buildDiscordClientOptions } from '../../../services/bot-client/src/utils/discordClientOptions.js';
import { createHttp, type InstanceHandle, loadHarness, runCleanup, timeout } from './instance.js';

describe('Machloket transport contract: default server configuration', () => {
  let inst: InstanceHandle;
  let botToken: string;
  let client: Client | undefined;

  beforeAll(async () => {
    const { bootInstance, account } = await loadHarness();
    inst = await bootInstance();
    const http = createHttp(inst);
    const owner = await account(inst, 'owner');
    const app = await http<{ id: string }>('/v10/applications', owner.token, 'POST', {
      name: 'parity-bot',
    });
    const bot = await http<{ token: string }>(
      `/v10/applications/${app.id}/bot`,
      owner.token,
      'POST'
    );
    botToken = bot.token;
  });

  afterAll(async () => {
    await runCleanup([() => client?.destroy(), () => inst?.close()]);
  });

  it('reaches ClientReady against a default-configured instance', async () => {
    const origin = `http://127.0.0.1:${String(inst.port)}`;
    client = new Client(buildDiscordClientOptions(origin));
    const activeClient = client;
    const ready = new Promise<void>(res => {
      activeClient.once(Events.ClientReady, () => {
        res();
      });
    });
    await timeout(activeClient.login(botToken), 60_000, 'login');
    await timeout(ready, 60_000, 'ClientReady');
    expect(client.isReady()).toBe(true);
  });
});
