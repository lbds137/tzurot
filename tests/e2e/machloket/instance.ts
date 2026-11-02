import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, Events, type Interaction, type Message, REST } from 'discord.js';
import { discordRestOptions } from '@tzurot/common-types/utils/discordInstanceOrigin';
import { buildDiscordClientOptions } from '../../../services/bot-client/src/utils/discordClientOptions.js';

export interface InstanceHandle {
  port: number;
  logPath: string;
  api(path: string): string;
  gatewayUrl(): string;
  close(): Promise<void>;
}

export interface Account {
  id: string;
  token: string;
  username?: string;
}

export interface Frame {
  op?: number;
  t?: string | null;
  s?: number | null;
  d: Record<string, unknown>;
}

export interface GatewayInstance {
  hello(): Promise<unknown>;
  send(payload: unknown): Promise<void>;
  next(timeoutMs?: number): Promise<Frame>;
  close(): void;
}

export type GatewayConstructor = new (url: string) => GatewayInstance;

export interface BootInstanceOptions {
  config?: Record<string, unknown>;
}

export interface HarnessModule {
  bootInstance: (options?: BootInstanceOptions) => Promise<InstanceHandle>;
  account: (inst: InstanceHandle, name: string) => Promise<Account>;
  Gateway: GatewayConstructor;
}

export type HttpFn = <T = Record<string, string>>(
  path: string,
  token: string,
  method?: string,
  body?: unknown
) => Promise<T>;

export type WaitFrameFn = (pred: (f: Frame) => boolean, ms?: number) => Promise<Frame>;

export interface GuildSummary {
  id: string;
}

export interface ChannelSummary {
  id: string;
  type: number;
}

export interface ApplicationSummary {
  id: string;
}

export interface BotSummary {
  token: string;
}

export interface ParityContext {
  inst: InstanceHandle;
  origin: string;
  owner: Account;
  person: Account;
  guild: GuildSummary;
  text: ChannelSummary;
  app: ApplicationSummary;
  bot: BotSummary;
  client: Client<true>;
  human: GatewayInstance;
  session: string;
  http: HttpFn;
  waitFrame: WaitFrameFn;
  rest: REST;
  close(): Promise<void>;
}

export interface MatchedInteraction {
  commandName: string;
  customId: string;
  deferred: boolean;
  user: { username: string };
  member: unknown;
  guildId: string | null;
  channel: { type: number } | null;
  values: string[];
  targetId: string;
  fields: { getTextInputValue(customId: string): string };
  isMessageContextMenuCommand(): boolean;
  deferReply(options?: Record<string, unknown>): Promise<unknown>;
  editReply(options: unknown): Promise<unknown>;
  reply(options: unknown): Promise<unknown>;
  followUp(options: unknown): Promise<Message>;
  deferUpdate(): Promise<unknown>;
  update(options: unknown): Promise<unknown>;
  showModal(modal: unknown): Promise<unknown>;
}

export async function loadHarness(): Promise<HarnessModule> {
  const dir = process.env.MACHLOKET_SERVER_DIR?.trim();
  if (dir === undefined || dir === '') {
    throw new Error(
      'MACHLOKET_SERVER_DIR must be set and point at a built machloket-server checkout'
    );
  }
  const instanceHref = pathToFileURL(resolve(dir, 'e2e/harness/instance.mts')).href;
  const gatewayHref = pathToFileURL(resolve(dir, 'e2e/harness/gateway.mts')).href;
  const instanceMod = (await import(instanceHref)) as {
    bootInstance: HarnessModule['bootInstance'];
    account: HarnessModule['account'];
  };
  const gatewayMod = (await import(gatewayHref)) as {
    Gateway: GatewayConstructor;
  };
  return {
    bootInstance: instanceMod.bootInstance,
    account: instanceMod.account,
    Gateway: gatewayMod.Gateway,
  };
}

export function createHttp(inst: InstanceHandle): HttpFn {
  return async <T = Record<string, string>>(
    path: string,
    token: string,
    method = 'GET',
    body?: unknown
  ): Promise<T> => {
    const res = await fetch(inst.api(path), {
      method,
      headers: { Authorization: token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { code?: number | string } | null;
      const code = errBody?.code;
      const suffix = code === undefined ? '' : ` code ${String(code)}`;
      throw new Error(`${method} ${path}: ${String(res.status)}${suffix}`);
    }
    const text = await res.text();
    return (text === '' ? null : JSON.parse(text)) as T;
  };
}

export function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      timer = setTimeout(() => {
        rej(new Error(`timeout ${String(ms)} ms: ${what}`));
      }, ms);
    }),
  ]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export function nextMessage(
  client: Client,
  pred: (m: Message) => boolean,
  ms = 20_000
): Promise<Message> {
  return new Promise<Message>((resolve, reject) => {
    const onMessage = (m: Message): void => {
      if (!pred(m)) {
        return;
      }
      clearTimeout(timer);
      client.off(Events.MessageCreate, onMessage);
      resolve(m);
    };
    const timer = setTimeout(() => {
      client.off(Events.MessageCreate, onMessage);
      reject(new Error(`timeout ${String(ms)} ms: MessageCreate`));
    }, ms);
    client.on(Events.MessageCreate, onMessage);
  });
}

export function nextInteraction(
  client: Client,
  pred: (i: MatchedInteraction) => boolean,
  ms = 20_000
): Promise<MatchedInteraction> {
  return new Promise<MatchedInteraction>((resolve, reject) => {
    const onInteraction = (i: Interaction): void => {
      const matched = i as unknown as MatchedInteraction;
      if (!pred(matched)) {
        return;
      }
      clearTimeout(timer);
      client.off(Events.InteractionCreate, onInteraction);
      resolve(matched);
    };
    const timer = setTimeout(() => {
      client.off(Events.InteractionCreate, onInteraction);
      reject(new Error(`timeout ${String(ms)} ms: InteractionCreate`));
    }, ms);
    client.on(Events.InteractionCreate, onInteraction);
  });
}

export function createWaitFrame(gateway: GatewayInstance): WaitFrameFn {
  return async (pred: (f: Frame) => boolean, ms = 20_000): Promise<Frame> => {
    const end = Date.now() + ms;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0) {
        throw new Error('no matching gateway frame');
      }
      const frame = await gateway.next(left);
      if (pred(frame)) {
        return frame;
      }
    }
  };
}

export async function runCleanup(steps: (() => unknown)[]): Promise<void> {
  let firstError: Error | undefined;
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      firstError ??= err instanceof Error ? err : new Error(String(err));
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

async function provisionGuildAndBot(
  http: HttpFn,
  owner: Account,
  person: Account
): Promise<{
  guild: GuildSummary;
  text: ChannelSummary;
  app: ApplicationSummary;
  bot: BotSummary;
}> {
  const guild = await http<GuildSummary>('/v10/guilds', owner.token, 'POST', { name: 'parity' });
  const channels = await http<ChannelSummary[]>(`/v10/guilds/${guild.id}/channels`, owner.token);
  const text = channels.find(c => c.type === 0);
  if (text === undefined) {
    throw new Error('no type-0 channel found in parity guild');
  }
  const app = await http<ApplicationSummary>('/v10/applications', owner.token, 'POST', {
    name: 'parity-bot',
  });
  const bot = await http<BotSummary>(`/v10/applications/${app.id}/bot`, owner.token, 'POST');
  await http(`/v10/oauth2/authorize?client_id=${app.id}`, owner.token, 'POST', {
    guild_id: guild.id,
    permissions: '8',
    authorize: true,
  });
  const invite = await http<{ code: string }>(
    `/v10/channels/${text.id}/invites`,
    owner.token,
    'POST',
    {}
  );
  await http(`/v10/invites/${invite.code}`, person.token, 'POST', {});
  return { guild, text, app, bot };
}

export async function bootParity(config?: Record<string, unknown>): Promise<ParityContext> {
  const { bootInstance, account, Gateway } = await loadHarness();
  const inst = await bootInstance({ config });
  const http = createHttp(inst);

  let client: Client | undefined;
  let human: GatewayInstance | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = async (): Promise<void> => {
    await runCleanup([
      () => {
        clearInterval(heartbeat);
      },
      () => client?.destroy(),
      () => {
        human?.close();
      },
      () => inst.close(),
    ]);
  };

  try {
    const owner = await account(inst, 'owner');
    const person = await account(inst, 'person');
    const { guild, text, app, bot } = await provisionGuildAndBot(http, owner, person);

    const origin = `http://127.0.0.1:${String(inst.port)}`;
    client = new Client(buildDiscordClientOptions(origin));
    const activeClient = client;
    const ready = new Promise<void>(res => {
      activeClient.once(Events.ClientReady, () => {
        res();
      });
    });
    await timeout(activeClient.login(bot.token), 60_000, 'login');
    await timeout(ready, 60_000, 'ClientReady');

    human = new Gateway(inst.gatewayUrl());
    const waitFrame = createWaitFrame(human);
    await human.hello();
    await human.send({
      op: 2,
      d: {
        token: person.token,
        properties: { os: 'linux', browser: 'e2e', device: 'e2e' },
      },
    });
    const readyFrame = await waitFrame(f => f.t === 'READY');
    const session = readyFrame.d.session_id as string;
    const activeHuman = human;
    heartbeat = setInterval(() => {
      activeHuman.send({ op: 1, d: null }).catch(() => {
        // The next waitFrame reports the closed socket.
      });
    }, 25_000).unref();
    const rest = new REST(discordRestOptions(origin)).setToken(bot.token);

    return {
      inst,
      origin,
      owner,
      person,
      guild,
      text,
      app,
      bot,
      client: activeClient as Client<true>,
      human,
      session,
      http,
      waitFrame,
      rest,
      close,
    };
  } catch (err) {
    // The boot error is the one worth reading.
    await close().catch(() => undefined);
    throw err;
  }
}
