import { describe, expect, it, vi } from 'vitest';
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from 'ts-morph';

import { analyzeProject } from './analyzer.js';
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
export declare class Webhook {
  send(options: { content: string; username?: string; avatarURL?: string }): Promise<unknown>;
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
