/**
 * Tests for chat-input command dispatch.
 *
 * Covers the three things this module owns: deferral-mode resolution
 * (including per-subcommand overrides), the ack + context-creation seam
 * (what the command receives must forward to the real interaction), and the
 * top-level error UX when execute() throws. The error-UX assertions run the
 * REAL replySpecSafe/topLevelErrorSpec/CATALOG — that seam IS the thing under
 * test, so mocking it would prove nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
} from 'discord.js';
import { InfraError } from '@tzurot/clients';
import { handleCommandWithContext, resolveEffectiveDeferralMode } from './commandDispatch.js';
import type { Command } from '../types.js';
import type { DeferralMode, SafeCommandContext } from '../utils/commandContext/index.js';
import { noteRenderedOutcome } from '../observability/commandOutcomeSlot.js';

const mockEmitCommandEvent = vi.fn();
vi.mock('../observability/emitCommandEvent.js', () => ({
  emitCommandEvent: (...args: unknown[]) => mockEmitCommandEvent(...args),
}));

const mockReportError = vi.fn();
vi.mock('../observability/ErrorChannelReporter.js', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

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

interface MockInteraction {
  commandName: string;
  deferred: boolean;
  replied: boolean;
  ephemeral: boolean | null;
  options: {
    getSubcommand: (required?: boolean) => string | null;
    getSubcommandGroup: (required?: boolean) => string | null;
    get: (name: string, required?: boolean) => { value: unknown } | null;
  };
  user: { id: string };
  guild: null;
  member: null;
  channel: null;
  channelId: string;
  guildId: null;
  deferReply: ReturnType<typeof vi.fn>;
  editReply: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
  followUp: ReturnType<typeof vi.fn>;
  deleteReply: ReturnType<typeof vi.fn>;
  showModal: ReturnType<typeof vi.fn>;
}

function makeInteraction(
  opts: { commandName?: string; subcommand?: string | null; group?: string | null } = {}
): MockInteraction {
  const interaction: MockInteraction = {
    commandName: opts.commandName ?? 'test',
    deferred: false,
    replied: false,
    ephemeral: null,
    options: {
      getSubcommand: () => opts.subcommand ?? null,
      getSubcommandGroup: () => opts.group ?? null,
      get: () => null,
    },
    user: { id: 'user-1' },
    guild: null,
    member: null,
    channel: null,
    channelId: 'channel-1',
    guildId: null,
    deferReply: vi.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

function asInteraction(mock: MockInteraction): ChatInputCommandInteraction {
  return mock as unknown as ChatInputCommandInteraction;
}

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    data: { name: 'test', description: 'Test command' } as unknown as SlashCommandBuilder,
    execute: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('resolveEffectiveDeferralMode', () => {
  it("defaults to 'ephemeral' when the command declares no deferralMode", () => {
    expect(resolveEffectiveDeferralMode(makeCommand(), asInteraction(makeInteraction()))).toBe(
      'ephemeral'
    );
  });

  it('uses the declared deferralMode when there is no override', () => {
    const command = makeCommand({ deferralMode: 'public' });
    expect(resolveEffectiveDeferralMode(command, asInteraction(makeInteraction()))).toBe('public');
  });

  it('applies a plain-subcommand override', () => {
    const command = makeCommand({
      deferralMode: 'ephemeral',
      subcommandDeferralModes: { set: 'modal' },
    });
    const interaction = makeInteraction({ subcommand: 'set' });
    expect(resolveEffectiveDeferralMode(command, asInteraction(interaction))).toBe('modal');
  });

  it("applies a 'group subcommand' path override", () => {
    const command = makeCommand({
      deferralMode: 'ephemeral',
      subcommandDeferralModes: { 'profile create': 'modal' },
    });
    const interaction = makeInteraction({ group: 'profile', subcommand: 'create' });
    expect(resolveEffectiveDeferralMode(command, asInteraction(interaction))).toBe('modal');
  });

  it('falls back to the command default when the interaction has no subcommand', () => {
    const command = makeCommand({
      deferralMode: 'public',
      subcommandDeferralModes: { set: 'modal' },
    });
    const interaction = makeInteraction({ subcommand: null, group: null });
    expect(resolveEffectiveDeferralMode(command, asInteraction(interaction))).toBe('public');
  });

  it('falls back to the command default when subcommand introspection throws', () => {
    // discord.js option getters throw on malformed/absent option payloads;
    // getSubcommandPath treats that as "no subcommand path".
    const command = makeCommand({
      deferralMode: 'public',
      subcommandDeferralModes: { set: 'modal' },
    });
    const interaction = makeInteraction();
    interaction.options.getSubcommand = () => {
      throw new Error('CommandInteractionOptionNotFound');
    };
    expect(resolveEffectiveDeferralMode(command, asInteraction(interaction))).toBe('public');
  });

  it('falls back to the command default when the subcommand has no override entry', () => {
    const command = makeCommand({
      deferralMode: 'none',
      subcommandDeferralModes: { set: 'modal' },
    });
    const interaction = makeInteraction({ subcommand: 'view' });
    expect(resolveEffectiveDeferralMode(command, asInteraction(interaction))).toBe('none');
  });
});

describe('handleCommandWithContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmitCommandEvent.mockClear();
  });

  it('replies ephemerally and skips dispatch when the command lookup came back empty', async () => {
    // Reachable only via a stale registration (Discord offering a command the
    // bot no longer loads) — the reply prevents "This interaction failed".
    const interaction = makeInteraction({ commandName: 'ghost' });

    await handleCommandWithContext(asInteraction(interaction), undefined);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Unknown command!',
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  it('defers EPHEMERAL by default and hands execute a context wired to the interaction', async () => {
    const interaction = makeInteraction();
    let seen: SafeCommandContext | undefined;
    const execute = vi.fn().mockImplementation(async (context: SafeCommandContext) => {
      seen = context;
      // Seam assertion: what the command calls must reach the interaction.
      await (context as { editReply: (o: unknown) => Promise<unknown> }).editReply({
        content: 'from-command',
      });
    });
    const command = makeCommand({ execute });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen).toBeDefined();
    expect((seen as { isEphemeral: boolean }).isEphemeral).toBe(true);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'from-command' });
  });

  it("defers WITHOUT the ephemeral flag in 'public' mode", async () => {
    const interaction = makeInteraction();
    const execute = vi.fn().mockResolvedValue(undefined);
    const command = makeCommand({ deferralMode: 'public', execute });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: undefined });
    const context = execute.mock.calls[0][0] as { isEphemeral: boolean };
    expect(context.isEphemeral).toBe(false);
  });

  it("does NOT defer in 'modal' mode and passes a modal context", async () => {
    const interaction = makeInteraction();
    const execute = vi.fn().mockImplementation(async (context: SafeCommandContext) => {
      await (context as { showModal: (m: unknown) => Promise<unknown> }).showModal('modal-builder');
    });
    const command = makeCommand({ deferralMode: 'modal', execute });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    // Seam: the modal context's showModal forwards to the interaction
    expect(interaction.showModal).toHaveBeenCalledWith('modal-builder');
  });

  it("does NOT defer in 'none' mode and passes a manual context", async () => {
    const interaction = makeInteraction();
    const execute = vi.fn().mockImplementation(async (context: SafeCommandContext) => {
      await (context as { reply: (o: unknown) => Promise<unknown> }).reply({ content: 'manual' });
    });
    const command = makeCommand({ deferralMode: 'none', execute });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith({ content: 'manual' });
  });

  it('routes a subcommand override through dispatch (modal subcommand of a deferred command)', async () => {
    const interaction = makeInteraction({ subcommand: 'set' });
    const execute = vi.fn().mockResolvedValue(undefined);
    const command = makeCommand({
      deferralMode: 'ephemeral',
      subcommandDeferralModes: { set: 'modal' },
      execute,
    });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('skips execute (and the error UX) when the defer itself fails', async () => {
    const interaction = makeInteraction();
    interaction.deferReply = vi.fn().mockRejectedValue(new Error('Unknown interaction'));
    const execute = vi.fn().mockResolvedValue(undefined);
    const command = makeCommand({ execute });

    await expect(
      handleCommandWithContext(asInteraction(interaction), command)
    ).resolves.toBeUndefined();

    expect(execute).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('fills the deferral placeholder via editReply when execute throws', async () => {
    const interaction = makeInteraction();
    const command = makeCommand({ execute: vi.fn().mockRejectedValue(new Error('boom')) });

    await expect(
      handleCommandWithContext(asInteraction(interaction), command)
    ).resolves.toBeUndefined();

    // deferred && !replied → editReply (fills "Thinking…"), not followUp
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ There was an error executing this command!',
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('routes an InfraError from execute to the transient copy', async () => {
    const interaction = makeInteraction();
    const command = makeCommand({
      execute: vi
        .fn()
        .mockRejectedValue(new InfraError({ ok: false, kind: 'timeout', error: 't/o', status: 0 })),
    });

    await handleCommandWithContext(asInteraction(interaction), command);

    const { content } = interaction.editReply.mock.calls[0][0] as { content: string };
    expect(content).toContain("Couldn't reach the server");
  });

  it("replies ephemerally when execute throws in an unacked mode ('none')", async () => {
    const interaction = makeInteraction();
    const command = makeCommand({
      deferralMode: 'none',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    });

    await handleCommandWithContext(asInteraction(interaction), command);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: '❌ There was an error executing this command!',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('does not throw when the error reply itself fails', async () => {
    const interaction = makeInteraction();
    interaction.editReply = vi.fn().mockRejectedValue(new Error('already acknowledged'));
    const command = makeCommand({ execute: vi.fn().mockRejectedValue(new Error('boom')) });

    await expect(
      handleCommandWithContext(asInteraction(interaction), command)
    ).resolves.toBeUndefined();
  });

  it('exercises every deferral mode without throwing', async () => {
    const modes: DeferralMode[] = ['ephemeral', 'public', 'modal', 'none'];
    for (const mode of modes) {
      const interaction = makeInteraction();
      const execute = vi.fn().mockResolvedValue(undefined);
      await handleCommandWithContext(
        asInteraction(interaction),
        makeCommand({ deferralMode: mode, execute })
      );
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });

  describe('command-telemetry emission', () => {
    it('emits exactly one ok event with the bare command name on success', async () => {
      const interaction = makeInteraction({ commandName: 'help' });
      const command = makeCommand({ execute: vi.fn().mockResolvedValue(undefined) });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockEmitCommandEvent).toHaveBeenCalledTimes(1);
      const event = mockEmitCommandEvent.mock.calls[0][0] as Record<string, unknown>;
      expect(event).toMatchObject({ command: 'help', outcome: 'ok', userId: 'user-1' });
      expect(typeof event.latencyMs).toBe('number');
    });

    it('joins group + subcommand into a dotted command path', async () => {
      const interaction = makeInteraction({ group: 'profile', subcommand: 'create' });
      const command = makeCommand({ execute: vi.fn().mockResolvedValue(undefined) });

      await handleCommandWithContext(asInteraction(interaction), command);

      const event = mockEmitCommandEvent.mock.calls[0][0] as Record<string, unknown>;
      expect(event.command).toBe('test.profile.create');
    });

    it('reports system_error with the constructor-name error code when execute throws', async () => {
      const interaction = makeInteraction();
      const command = makeCommand({ execute: vi.fn().mockRejectedValue(new TypeError('boom')) });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockEmitCommandEvent).toHaveBeenCalledTimes(1);
      const event = mockEmitCommandEvent.mock.calls[0][0] as Record<string, unknown>;
      expect(event.outcome).toBe('system_error');
      expect(event.errorCode).toBe('TypeError');
    });

    it('reports the system_error to the owner-channel reporter with the dotted command path', async () => {
      const interaction = makeInteraction({ group: 'profile', subcommand: 'create' });
      const thrown = new TypeError('boom');
      const command = makeCommand({ execute: vi.fn().mockRejectedValue(thrown) });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockReportError).toHaveBeenCalledTimes(1);
      const report = mockReportError.mock.calls[0][0] as Record<string, unknown>;
      expect(report).toMatchObject({
        source: 'command',
        errorCode: 'TypeError',
        command: 'test.profile.create',
        error: thrown,
      });
      expect(typeof report.latencyMs).toBe('number');
    });

    it('does NOT report to the owner-channel reporter on success', async () => {
      const interaction = makeInteraction({ commandName: 'help' });
      const command = makeCommand({ execute: vi.fn().mockResolvedValue(undefined) });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockReportError).not.toHaveBeenCalled();
    });

    it('reports user_error when a failed spec renders during execute', async () => {
      const interaction = makeInteraction();
      const command = makeCommand({
        execute: vi.fn().mockImplementation(async () => {
          noteRenderedOutcome({ severity: 'error', outcome: 'failed', text: 'nope' });
        }),
      });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockEmitCommandEvent).toHaveBeenCalledTimes(1);
      const event = mockEmitCommandEvent.mock.calls[0][0] as Record<string, unknown>;
      expect(event.outcome).toBe('user_error');
    });

    it('emits nothing on the unknown-command path', async () => {
      const interaction = makeInteraction({ commandName: 'ghost' });

      await handleCommandWithContext(asInteraction(interaction), undefined);

      expect(mockEmitCommandEvent).not.toHaveBeenCalled();
    });

    it('emits nothing when the defer itself fails', async () => {
      const interaction = makeInteraction();
      interaction.deferReply = vi.fn().mockRejectedValue(new Error('Unknown interaction'));
      const command = makeCommand({ execute: vi.fn().mockResolvedValue(undefined) });

      await handleCommandWithContext(asInteraction(interaction), command);

      expect(mockEmitCommandEvent).not.toHaveBeenCalled();
    });
  });
});
