import { describe, expect, it, vi } from 'vitest';
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph';

import { analyzeProject } from './analyzer.js';
import { UNKNOWN_PAYLOAD_KEY } from './payloadKeys.js';
import type { SurfaceEntry } from './types.js';

// ts-morph program creation has a cold-start cost (see xray/analyzer.test.ts);
// the in-memory fixture here is much smaller but still compiles a program.
vi.setConfig({ testTimeout: 30_000 });

const DISCORD_TYPES = `
export declare class BaseInteraction {
  reply(options: { content: string; embeds?: unknown[] }): Promise<unknown>;
  showModal(modal: unknown): void;
  respond(choices: unknown[]): void;
  deferUpdate(): Promise<unknown>;
  deleteReply(): Promise<unknown>;
}
export declare enum Events {
  MessageCreate = 'messageCreate',
  ClientReady = 'ready',
}
export declare enum MessageFlags {
  Ephemeral = 1 << 6,
}
export declare enum TextInputStyle {
  Short = 1,
}
export declare enum ButtonStyle {
  Primary = 1,
  Secondary = 2,
}
export declare class ButtonBuilder {
  setLabel(label: string): this;
}
export declare class EmbedBuilder {
  constructor(data?: { title?: string });
  addFields(f: { name: string; value: string }): this;
}
export interface WebhookMessageCreateOptions {
  content?: string;
  username?: string;
  avatarURL?: string;
  threadId?: string;
  allowedMentions?: { parse: string[] };
  files?: unknown[];
  toJSON(): unknown;
}
export declare class Webhook {
  send(options: { content: string; username?: string; avatarURL?: string }): Promise<unknown>;
  sendRaw(options: WebhookMessageCreateOptions): Promise<unknown>;
}
export declare class TextChannel {
  createWebhook(options: { name: string; reason?: string }): Promise<Webhook>;
}
export declare class ModalBuilder {
  setTitle(title: string): this;
}
export declare class WeirdFuturePrimitive {
  ping(): void;
}
`;

const FIXTURE = `
import {
  BaseInteraction,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  TextInputStyle,
  Webhook,
  WeirdFuturePrimitive,
} from 'discord.js';

declare function on(name: Events, handler: () => void): void;

function applyFlags(payload: { flags?: number }): void {
  void payload;
}

class LocalHelper {
  doThing(): void {
    /* local helper, never part of the discord.js surface */
  }
}

export async function exercise(
  interaction: BaseInteraction,
  webhook: Webhook,
  modal: unknown,
  content: string
): Promise<void> {
  const embeds = [] as unknown[];
  const rest = { content: 'spread keys are not key sites' };
  await interaction.reply({ content, embeds, ...rest });
  interaction.showModal(modal);
  interaction.respond([]);
  interaction.deferUpdate();
  void new ButtonBuilder().setLabel('x');
  const replyReference = interaction.reply;
  void replyReference;
  webhook.send({ content: 'x', username: 'y' });
  const weird = new WeirdFuturePrimitive();
  weird.ping();
  void TextInputStyle.Short;
  void ButtonStyle.Primary;
  void new EmbedBuilder().addFields({ name: 'a', value: 'b' });
  const title = 'x';
  void new EmbedBuilder({ title });
  on(Events.MessageCreate, () => undefined);
  applyFlags({ flags: MessageFlags.Ephemeral });
  const helper = new LocalHelper();
  helper.doThing();
  fetch('https://discord.com/api/v10/users/@me');
  fetch('https://example.com/nope');
}
`;

const FIXTURE_TEST = `
import { BaseInteraction } from 'discord.js';

export async function testOnly(interaction: BaseInteraction): Promise<void> {
  await interaction.reply({ content: 'from a test file' });
}
`;

// Variable-passed payloads: the options object reaches the call by identifier.
const FIXTURE_VARIABLE_ANNOTATED = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

export async function annotatedOnly(
  webhook: Webhook,
  annotatedOptions: WebhookMessageCreateOptions
): Promise<void> {
  await webhook.sendRaw(annotatedOptions);
}

export async function anonymousOnly(
  webhook: Webhook,
  inlinePayload: { content: string; files?: unknown[] }
): Promise<void> {
  await webhook.send(inlinePayload);
}
`;

const FIXTURE_VARIABLE_RETURN = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

function buildOptions(flag: boolean): WebhookMessageCreateOptions {
  const options: WebhookMessageCreateOptions = { content: 'x', username: 'u' };
  return flag ? options : { ...options, threadId: 't' };
}

export async function viaCall(webhook: Webhook): Promise<void> {
  await webhook.sendRaw(buildOptions(true));
}
`;

const FIXTURE_VARIABLE_LITERAL_INIT = `
import { Webhook, WebhookMessageCreateOptions, type TextChannel } from 'discord.js';

export async function literalInitialized(webhook: Webhook, channel: TextChannel): Promise<void> {
  const declared: WebhookMessageCreateOptions = { content: 'x', username: 'u' };
  declared.threadId = 't';
  declared.threadId = 't2';
  await webhook.sendRaw(declared);
  const inline: { content: string; username?: string; files?: unknown[] } = { content: 'x' };
  inline.files = [];
  await webhook.send(inline);
  await channel.createWebhook({ name: 'n', reason: 'r' });
}
`;

const FIXTURE_VARIABLE_UNION = `
import { Webhook } from 'discord.js';

interface NamedA {
  content: string;
}
interface NamedB {
  content: string;
  username?: string;
}

export async function namedUnion(webhook: Webhook, payload: NamedA | NamedB): Promise<void> {
  await webhook.send(payload);
}

export async function anonymousUnion(
  webhook: Webhook,
  payload: { content: string } | { content: string; avatarURL: string }
): Promise<void> {
  await webhook.send(payload);
}

export async function namedIntersection(
  webhook: Webhook,
  payload: NamedA & { username: string }
): Promise<void> {
  await webhook.send(payload);
}

export async function anonymousIntersection(
  webhook: Webhook,
  payload: { content: string } & { username: string }
): Promise<void> {
  await webhook.send(payload);
}
`;

const FIXTURE_VARIABLE_ORDER = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

export async function twoSends(webhook: Webhook): Promise<void> {
  const options: WebhookMessageCreateOptions = { content: 'x' };
  await webhook.sendRaw(options);
  options.threadId = 't';
  await webhook.sendRaw(options);
}
`;

const FIXTURE_ALIAS_UNION = `
import { Webhook } from 'discord.js';

type AliasedPayload = { aliasA: string } | { aliasB: string };

export async function aliasedUnion(webhook: Webhook, payload: AliasedPayload): Promise<void> {
  await webhook.send(payload);
}
`;

const FIXTURE_REASSIGN = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

declare function externalOptions(): WebhookMessageCreateOptions;

export async function literalReassigned(webhook: Webhook, flag: boolean): Promise<void> {
  let options: WebhookMessageCreateOptions = { content: 'x' };
  if (flag) {
    options = { content: 'x', threadId: 't' };
  }
  await webhook.sendRaw(options);
}

export async function nonLiteralReassigned(webhook: Webhook): Promise<void> {
  let options: WebhookMessageCreateOptions = { username: 'u' };
  options = externalOptions();
  await webhook.sendRaw(options);
}

export async function reassignedAfterCall(webhook: Webhook): Promise<void> {
  let options: WebhookMessageCreateOptions = { avatarURL: 'a' };
  await webhook.sendRaw(options);
  options = externalOptions();
}
`;

const FIXTURE_MOCK_DIR = `
import { Webhook } from 'discord.js';

export function mockDirSite(webhook: Webhook): void {
  void webhook.send({ content: 'mock-dir' });
}
`;

const FIXTURE_MOCK_SUFFIX = `
import { Webhook } from 'discord.js';

export function mockSuffixSite(webhook: Webhook): void {
  void webhook.send({ content: 'mock-suffix' });
}
`;

const FIXTURE_SPREAD_GAPS = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

declare function externalExtras(): WebhookMessageCreateOptions;

function spreadNamedParam(extra: WebhookMessageCreateOptions): WebhookMessageCreateOptions {
  return { ...extra, threadId: 't' };
}

function spreadCall(): WebhookMessageCreateOptions {
  return { ...externalExtras(), avatarURL: 'a' };
}

function spreadMember(holder: { inner: WebhookMessageCreateOptions }): WebhookMessageCreateOptions {
  return { ...holder.inner, username: 'u' };
}

function spreadResolved(): WebhookMessageCreateOptions {
  const base = { content: 'x' };
  return { ...base, files: [] };
}

export async function sendAll(webhook: Webhook, extra: WebhookMessageCreateOptions): Promise<void> {
  await webhook.sendRaw(spreadNamedParam(extra));
  await webhook.sendRaw(spreadCall());
  await webhook.sendRaw(spreadMember({ inner: extra }));
  await webhook.sendRaw(spreadResolved());
}
`;

const FIXTURE_RETURNED_IDENTIFIER = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

function passThrough(extra: WebhookMessageCreateOptions): WebhookMessageCreateOptions {
  return extra;
}

function resolvedLocal(): WebhookMessageCreateOptions {
  const local: WebhookMessageCreateOptions = { content: 'x' };
  return local;
}

export async function sendReturned(webhook: Webhook, extra: WebhookMessageCreateOptions): Promise<void> {
  await webhook.sendRaw(passThrough(extra));
  await webhook.sendRaw(resolvedLocal());
}
`;

const FIXTURE_NESTED_WRITE = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

export async function nestedWrite(webhook: Webhook): Promise<void> {
  const options: WebhookMessageCreateOptions = { content: 'x' };
  const other: { threadId?: string } = {};
  other.threadId = 't';
  options.allowedMentions!.parse = [];
  await webhook.sendRaw(options);
}
`;

// Direct call arguments whose callee has no readable body.
const FIXTURE_UNRESOLVABLE_CALLEE = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

declare function ambientOptions(): WebhookMessageCreateOptions;

interface OptionsFactory {
  make(): WebhookMessageCreateOptions;
}

function literalOptions(): WebhookMessageCreateOptions {
  return { username: 'u' };
}

export async function sendUnresolvable(webhook: Webhook, factory: OptionsFactory): Promise<void> {
  await webhook.sendRaw(ambientOptions());
  await webhook.sendRaw(factory.make());
  await webhook.sendRaw(literalOptions());
}
`;

// Returned-expression shapes beyond literals, identifiers and conditionals.
const FIXTURE_RETURN_SHAPES = `
import { Webhook, WebhookMessageCreateOptions } from 'discord.js';

declare function ambientOptions(): WebhookMessageCreateOptions;

function innerLiteral(): WebhookMessageCreateOptions {
  return { avatarURL: 'a' };
}

function asCast(): WebhookMessageCreateOptions {
  return { content: 'x' } as WebhookMessageCreateOptions;
}

function satisfiesCheck(): { username: string } {
  return { username: 'u' } satisfies { username: string };
}

function nonNullLocal(): WebhookMessageCreateOptions {
  const local: WebhookMessageCreateOptions | undefined = { threadId: 't' };
  return local!;
}

function delegatesResolvable(): WebhookMessageCreateOptions {
  return innerLiteral();
}

function delegatesAmbient(): WebhookMessageCreateOptions {
  return ambientOptions();
}

function returnsMember(holder: { inner: WebhookMessageCreateOptions }): WebhookMessageCreateOptions {
  return holder.inner;
}

function pingA(n: number): WebhookMessageCreateOptions {
  return n > 0 ? pingB(n - 1) : { files: [] };
}

function pingB(n: number): WebhookMessageCreateOptions {
  return pingA(n);
}

export async function sendShapes(
  webhook: Webhook,
  holder: { inner: WebhookMessageCreateOptions }
): Promise<void> {
  await webhook.sendRaw(asCast());
  await webhook.send(satisfiesCheck());
  await webhook.sendRaw(nonNullLocal());
  await webhook.sendRaw(delegatesResolvable());
  await webhook.sendRaw(delegatesAmbient());
  await webhook.sendRaw(returnsMember(holder));
  await webhook.sendRaw(pingA(1));
}
`;

// Builders whose returned value is not a payload object (a string, a class
// instance) beside a control whose returned local is a named payload type.
const FIXTURE_NON_PAYLOAD_RETURNS = `
import { BaseInteraction, ModalBuilder, Webhook, WebhookMessageCreateOptions } from 'discord.js';

declare function ambientOptions(): WebhookMessageCreateOptions;

function textReply(name: string): string {
  return \`hello \${name}\`;
}

function buildModal(): ModalBuilder {
  const m = new ModalBuilder().setTitle('t');
  return m;
}

function declaredLocal(): WebhookMessageCreateOptions {
  const local: WebhookMessageCreateOptions = ambientOptions();
  return local;
}

export async function sendNonPayload(interaction: BaseInteraction, webhook: Webhook): Promise<void> {
  await interaction.reply(textReply('x'));
  interaction.showModal(buildModal());
  await webhook.sendRaw(declaredLocal());
}
`;

const GLOBAL_TYPES = `
declare function fetch(input: string): Promise<unknown>;
`;

function buildFixtureProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ScriptTarget.ES2022,
      lib: ['es2022'],
      module: ModuleKind.CommonJS,
      moduleResolution: ModuleResolutionKind.Node10,
    },
  });
  project.createSourceFile(
    '/node_modules/discord.js/package.json',
    JSON.stringify({ name: 'discord.js', version: '0.0.0', types: 'index.d.ts' })
  );
  project.createSourceFile('/node_modules/discord.js/index.d.ts', DISCORD_TYPES);
  project.createSourceFile('/proj/globals.d.ts', GLOBAL_TYPES);
  // Fixture files sit under the analyzer's real scope directory
  // (services/bot-client/src relative to the fixture root '/proj').
  project.createSourceFile('/proj/services/bot-client/src/fixture.ts', FIXTURE);
  project.createSourceFile('/proj/services/bot-client/src/fixture.test.ts', FIXTURE_TEST);
  project.createSourceFile(
    '/proj/services/bot-client/src/variableAnnotated.ts',
    FIXTURE_VARIABLE_ANNOTATED
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/variableReturn.ts',
    FIXTURE_VARIABLE_RETURN
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/variableLiteralInit.ts',
    FIXTURE_VARIABLE_LITERAL_INIT
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/variableUnion.ts',
    FIXTURE_VARIABLE_UNION
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/variableOrder.ts',
    FIXTURE_VARIABLE_ORDER
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/variableAliasUnion.ts',
    FIXTURE_ALIAS_UNION
  );
  project.createSourceFile('/proj/services/bot-client/src/variableReassign.ts', FIXTURE_REASSIGN);
  project.createSourceFile('/proj/services/bot-client/src/spreadGaps.ts', FIXTURE_SPREAD_GAPS);
  project.createSourceFile('/proj/services/bot-client/src/nestedWrite.ts', FIXTURE_NESTED_WRITE);
  project.createSourceFile(
    '/proj/services/bot-client/src/returnedIdentifier.ts',
    FIXTURE_RETURNED_IDENTIFIER
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/unresolvableCallee.ts',
    FIXTURE_UNRESOLVABLE_CALLEE
  );
  project.createSourceFile('/proj/services/bot-client/src/returnShapes.ts', FIXTURE_RETURN_SHAPES);
  project.createSourceFile(
    '/proj/services/bot-client/src/nonPayloadReturns.ts',
    FIXTURE_NON_PAYLOAD_RETURNS
  );
  project.createSourceFile(
    '/proj/services/bot-client/src/test/mocks/Discord.mock.ts',
    FIXTURE_MOCK_DIR
  );
  project.createSourceFile('/proj/services/bot-client/src/widget.mock.ts', FIXTURE_MOCK_SUFFIX);
  return project;
}

// Anonymous payload types carrying a method and lib-declared members (the
// spread of an Error copies `name` / `message` / `stack` / `cause`, declared in
// TypeScript's lib files).
const FIXTURE_ANONYMOUS_MEMBERS = `
import { Webhook } from 'discord.js';

export function sendAnonymous(
  webhook: Webhook,
  payload: { content: string; toJSON(): unknown },
  err: Error
): void {
  void webhook.send(payload);
  void webhook.send(({ username: 'u', ...err }));
}
`;

/**
 * A separate project whose global lib actually loads: ts-morph's in-memory
 * host resolves `lib` entries by FILE name, so the main fixture's
 * `lib: ['es2022']` loads no lib file and `Error` would not resolve there.
 */
function buildLibFixtureProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      strict: true,
      target: ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts'],
      module: ModuleKind.CommonJS,
      moduleResolution: ModuleResolutionKind.Node10,
    },
  });
  project.createSourceFile(
    '/node_modules/discord.js/package.json',
    JSON.stringify({ name: 'discord.js', version: '0.0.0', types: 'index.d.ts' })
  );
  project.createSourceFile('/node_modules/discord.js/index.d.ts', DISCORD_TYPES);
  project.createSourceFile(
    '/proj/services/bot-client/src/anonymousMembers.ts',
    FIXTURE_ANONYMOUS_MEMBERS
  );
  return project;
}

function findEntry(
  entries: SurfaceEntry[],
  category: string,
  symbol: string,
  file: string
): SurfaceEntry | undefined {
  return entries.find(
    entry => entry.category === category && entry.symbol === symbol && entry.file === file
  );
}

describe('analyzeProject', () => {
  it('classifies the fixture project into the expected categories', () => {
    const project = buildFixtureProject();
    const entries = analyzeProject(project, '/proj');

    // interaction acks: reply/showModal/respond/deferUpdate land here, with
    // the reply read merging into the reply call's entry (count 2).
    for (const method of ['reply', 'showModal', 'respond', 'deferUpdate']) {
      const entry = findEntry(
        entries,
        'interaction-acks',
        method,
        'services/bot-client/src/fixture.ts'
      );
      expect(entry, `expected ${method} in interaction-acks`).toBeDefined();
    }
    expect(
      findEntry(entries, 'interaction-acks', 'reply', 'services/bot-client/src/fixture.ts')?.count
    ).toBe(2);

    // construction + component enums (container-qualified symbol names)
    expect(
      findEntry(entries, 'components', 'ButtonBuilder', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      findEntry(entries, 'components', 'TextInputStyle.Short', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();

    // gateway events and flags (container-qualified symbol names)
    expect(
      findEntry(
        entries,
        'gateway-events',
        'Events.MessageCreate',
        'services/bot-client/src/fixture.ts'
      )
    ).toBeDefined();
    expect(
      findEntry(entries, 'flags', 'MessageFlags.Ephemeral', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();

    // unmapped enum members default to discord-enums, container-qualified —
    // the exact symbol string is pinned so distinct enums' same-named
    // members provably cannot merge.
    expect(
      findEntry(
        entries,
        'discord-enums',
        'ButtonStyle.Primary',
        'services/bot-client/src/fixture.ts'
      )
    ).toBeDefined();
    expect(
      entries.some(entry => entry.category === 'discord-enums' && entry.symbol === 'Primary')
    ).toBe(false);

    // message builders: construction and embed field-literal keys
    expect(
      findEntry(entries, 'message-builders', 'EmbedBuilder', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      findEntry(entries, 'message-builders', 'name', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      findEntry(entries, 'message-builders', 'value', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();

    // constructor object-literal keys classify by the receiver's builder family
    expect(
      findEntry(entries, 'message-builders', 'title', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      entries.some(entry => entry.category === 'unclassified' && entry.symbol === 'title')
    ).toBe(false);

    // webhook option keys
    expect(
      findEntry(entries, 'webhook-options', 'content', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      findEntry(entries, 'webhook-options', 'username', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();

    // raw fetch to the Discord API is caught; other hosts are not recorded
    // (exactly one rest-outside-helpers entry: the discord.com call — the
    // fixture's example.com fetch produced no inventory entry; a regressed
    // example.com match would merge into this entry and bump its count)
    expect(
      findEntry(entries, 'rest-outside-helpers', 'fetch', 'services/bot-client/src/fixture.ts')
        ?.count
    ).toBe(1);

    // the undeclared discord.js primitive surfaces as unclassified
    expect(
      findEntry(
        entries,
        'unclassified',
        'WeirdFuturePrimitive',
        'services/bot-client/src/fixture.ts'
      )
    ).toBeDefined();

    // negative controls: local code never enters the inventory
    expect(entries.some(entry => entry.symbol === 'doThing')).toBe(false);
    expect(entries.some(entry => entry.file === 'services/bot-client/src/fixture.test.ts')).toBe(
      false
    );
  });

  it('records shorthand option-key sites and classifies them by the receiver family', () => {
    const project = buildFixtureProject();
    const entries = analyzeProject(project, '/proj');

    // The reply literal is `{ content, embeds, ...rest }` — every key in it
    // is shorthand (the spread adds none). The receiver BaseInteraction has
    // no builder table, so both keys route through the MESSAGE_OPTION_KEYS
    // vocabulary into `message-options`.
    expect(
      findEntry(entries, 'message-options', 'content', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      findEntry(entries, 'message-options', 'embeds', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();

    // The constructor literal `{ title }` is shorthand too; the receiver's
    // builder family classifies it, exactly like a property assignment would.
    expect(
      findEntry(entries, 'message-builders', 'title', 'services/bot-client/src/fixture.ts')
    ).toBeDefined();
    expect(
      entries.some(entry => entry.category === 'unclassified' && entry.symbol === 'title')
    ).toBe(false);

    // A spread element is not a key site: `...rest` contributes no entry.
    expect(entries.some(entry => entry.symbol === 'rest')).toBe(false);
  });

  it('excludes every test-file site from the inventory (mock-poison exclusion)', () => {
    const project = buildFixtureProject();
    const entries = analyzeProject(project, '/proj');
    for (const entry of entries) {
      expect(entry.file.endsWith('.test.ts')).toBe(false);
    }
  });

  it('records only the unknown-payload marker for a parameter typed as a whole named interface', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableAnnotated.ts';
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(1);
    // the declared member list is NOT claimed as sent keys
    for (const key of ['avatarURL', 'threadId', 'allowedMentions', 'toJSON']) {
      expect(entries.some(entry => entry.file === file && entry.symbol === key)).toBe(false);
    }
  });

  it('records the properties of an anonymous object type', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableAnnotated.ts';
    expect(findEntry(entries, 'webhook-options', 'content', file)).toBeDefined();
    expect(findEntry(entries, 'webhook-options', 'files', file)).toBeDefined();
  });

  it('records the literal subset an in-project function returns, not its declared return type', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableReturn.ts';
    const recorded = entries.filter(
      entry => entry.file === file && entry.category === 'webhook-options'
    );
    expect(recorded.map(entry => entry.symbol).sort()).toEqual(['content', 'threadId', 'username']);
  });

  it('uses the initializer keys plus later member assignments, not the full declared type', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableLiteralInit.ts';
    // annotated variable: initializer {content, username} + `declared.threadId = …`
    // (assigned twice — the key still counts once per send site)
    expect(findEntry(entries, 'webhook-options', 'content', file)).toBeDefined();
    expect(findEntry(entries, 'webhook-options', 'username', file)).toBeDefined();
    expect(findEntry(entries, 'webhook-options', 'threadId', file)?.count).toBe(1);
    // declared on the type but never set: must not appear
    for (const unset of ['avatarURL', 'allowedMentions']) {
      expect(entries.some(entry => entry.file === file && entry.symbol === unset)).toBe(false);
    }
    // inline-typed variable: initializer {content} + `inline.files = …`
    expect(findEntry(entries, 'webhook-options', 'files', file)).toBeDefined();
  });

  it('records the marker for unions / intersections that include a named type, never silence', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableUnion.ts';
    // namedUnion + namedIntersection each contribute one marker
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(2);
  });

  it('records the properties of anonymous unions and intersections', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableUnion.ts';
    expect(findEntry(entries, 'webhook-options', 'avatarURL', file)?.count).toBe(1);
    // anonymousUnion + anonymousIntersection
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(2);
    expect(findEntry(entries, 'webhook-options', 'username', file)?.count).toBe(1);
  });

  it('records only the marker for a named alias over a union of anonymous objects', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableAliasUnion.ts';
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(1);
    for (const key of ['aliasA', 'aliasB']) {
      expect(entries.some(entry => entry.file === file && entry.symbol === key)).toBe(false);
    }
  });

  it('counts the keys of a whole reassignment that precedes the call', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableReassign.ts';
    // literalReassigned: initializer {content} + reassignment {content, threadId}
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(1);
    expect(findEntry(entries, 'webhook-options', 'threadId', file)?.count).toBe(1);
  });

  it('records the marker beside the known keys for a non-literal reassignment before the call', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableReassign.ts';
    expect(findEntry(entries, 'webhook-options', 'username', file)?.count).toBe(1);
    // only nonLiteralReassigned reassigns to an unreadable value before its call
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(1);
  });

  it('ignores a reassignment that follows the call', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableReassign.ts';
    expect(findEntry(entries, 'webhook-options', 'avatarURL', file)?.count).toBe(1);
  });

  it('counts a member assignment only for calls that follow it', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableOrder.ts';
    // content is sent by both calls; threadId only by the second
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(2);
    expect(findEntry(entries, 'webhook-options', 'threadId', file)?.count).toBe(1);
  });

  it('records the marker beside the known keys for spreads a returned literal cannot resolve', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/spreadGaps.ts';
    // named-typed param spread, call spread and member spread each add one marker;
    // the object-literal-initialized spread (spreadResolved) adds none
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(3);
    for (const key of ['threadId', 'avatarURL', 'username']) {
      expect(findEntry(entries, 'webhook-options', key, file)?.count).toBe(1);
    }
  });

  it('still resolves a spread of an object-literal-initialized variable without a marker', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/spreadGaps.ts';
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(1);
    expect(findEntry(entries, 'webhook-options', 'files', file)?.count).toBe(1);
  });

  it('counts the top-level key of a nested member write and ignores other variables', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/nestedWrite.ts';
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(1);
    expect(findEntry(entries, 'webhook-options', 'allowedMentions', file)?.count).toBe(1);
    // `parse` is nested, and `other.threadId` is a write to a different variable
    // (`parse` still appears as its own client-methods site; only the payload keys matter here)
    for (const absent of ['parse', 'threadId']) {
      expect(findEntry(entries, 'webhook-options', absent, file)).toBeUndefined();
    }
  });

  it('records the marker for a returned identifier with no literal initializer, keys for a resolved one', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/returnedIdentifier.ts';
    // passThrough returns its parameter (unreadable → one marker); resolvedLocal adds content
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(1);
    expect(findEntry(entries, 'webhook-options', 'content', file)?.count).toBe(1);
  });

  it('records the marker for a call argument whose callee has no readable body', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/unresolvableCallee.ts';
    // ambient `declare function` + interface method: one marker each, never silence
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(2);
    // a resolvable callee returning a literal still yields exactly its keys
    expect(findEntry(entries, 'webhook-options', 'username', file)?.count).toBe(1);
    for (const key of ['content', 'avatarURL', 'threadId', 'allowedMentions', 'files']) {
      expect(findEntry(entries, 'webhook-options', key, file)).toBeUndefined();
    }
  });

  it('reads returned casts, satisfies, non-null assertions and delegated calls', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/returnShapes.ts';
    // asCast, satisfiesCheck, nonNullLocal, delegatesResolvable, and the
    // literal branch of the mutually recursive pingA / pingB pair
    for (const key of ['content', 'username', 'threadId', 'avatarURL', 'files']) {
      expect(findEntry(entries, 'webhook-options', key, file)?.count, key).toBe(1);
    }
    // delegatesAmbient (bodiless callee) + returnsMember (member access)
    expect(findEntry(entries, 'webhook-options', UNKNOWN_PAYLOAD_KEY, file)?.count).toBe(2);
  });

  it('records no marker for a returned string or builder instance, the marker for a named payload local', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/nonPayloadReturns.ts';
    const markers = entries.filter(
      entry => entry.file === file && entry.symbol === UNKNOWN_PAYLOAD_KEY
    );
    // only declaredLocal (named interface, no literal initializer) is unknown;
    // textReply (template string) and buildModal (class instance) are no payload
    expect(markers.map(entry => [entry.category, entry.count])).toEqual([['webhook-options', 1]]);
  });

  it('excludes methods and lib-declared members of an anonymous payload type', () => {
    const entries = analyzeProject(buildLibFixtureProject(), '/proj');
    const file = 'services/bot-client/src/anonymousMembers.ts';
    for (const key of ['content', 'username']) {
      expect(findEntry(entries, 'webhook-options', key, file)?.count, key).toBe(1);
    }
    // toJSON is a method; name / message / stack / cause are declared in lib files
    for (const key of ['toJSON', 'name', 'message', 'stack', 'cause']) {
      expect(findEntry(entries, 'webhook-options', key, file), key).toBeUndefined();
    }
  });

  it('classifies createWebhook options as webhook-options', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    const file = 'services/bot-client/src/variableLiteralInit.ts';
    expect(findEntry(entries, 'webhook-options', 'name', file)).toBeDefined();
    expect(findEntry(entries, 'webhook-options', 'reason', file)).toBeDefined();
    expect(entries.some(entry => entry.category === 'unclassified' && entry.file === file)).toBe(
      false
    );
  });

  it('excludes /src/test/ directory files and *.mock.ts files from the inventory', () => {
    const entries = analyzeProject(buildFixtureProject(), '/proj');
    expect(entries.some(entry => entry.file.includes('/src/test/'))).toBe(false);
    expect(entries.some(entry => entry.file.endsWith('.mock.ts'))).toBe(false);
  });

  it('returns entries sorted by category, then file, then symbol', () => {
    const project = buildFixtureProject();
    const entries = analyzeProject(project, '/proj');
    // Deliberately a copy, not an import: an independent oracle for the sort order.
    const sorted = [...entries].sort((a, b) => {
      if (a.category !== b.category) return a.category < b.category ? -1 : 1;
      if (a.file !== b.file) return a.file < b.file ? -1 : 1;
      if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
      return 0;
    });
    expect(entries).toEqual(sorted);
  });

  it('is deterministic across repeated runs of the same project', () => {
    const project = buildFixtureProject();
    const first = analyzeProject(project, '/proj');
    const second = analyzeProject(project, '/proj');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('throws a scope-naming error when the project has no bot-client source', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/elsewhere/code.ts', 'export const x = 1;\n');
    expect(() => analyzeProject(project, '/proj')).toThrow(/surface inventory scope is empty/);
  });
});
