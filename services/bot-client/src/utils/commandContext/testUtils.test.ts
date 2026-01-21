/**
 * Tests for Command Context Test Utilities
 *
 * Verifies that mock factory functions create properly structured contexts.
 */

import { describe, it, expect } from 'vitest';
import {
  createMockDeferredContext,
  createMockModalContext,
  createMockManualContext,
} from './testUtils.js';
import { isDeferredContext, isModalContext, isManualContext } from './types.js';
import type { SafeCommandContext } from './types.js';

describe('createMockDeferredContext', () => {
  it('should create context with default values', () => {
    const ctx = createMockDeferredContext();

    expect(ctx.user.id).toBe('user-123');
    expect(ctx.guildId).toBe('guild-123');
    expect(ctx.channelId).toBe('channel-123');
    expect(ctx.commandName).toBe('test-command');
    expect(ctx.isEphemeral).toBe(true);
  });

  it('should create context with custom values', () => {
    const ctx = createMockDeferredContext({
      userId: 'custom-user',
      guildId: 'custom-guild',
      channelId: 'custom-channel',
      commandName: 'custom-command',
      isEphemeral: false,
    });

    expect(ctx.user.id).toBe('custom-user');
    expect(ctx.guildId).toBe('custom-guild');
    expect(ctx.channelId).toBe('custom-channel');
    expect(ctx.commandName).toBe('custom-command');
    expect(ctx.isEphemeral).toBe(false);
  });

  it('should support null guildId for DMs', () => {
    const ctx = createMockDeferredContext({ guildId: null });

    expect(ctx.guildId).toBeNull();
    expect(ctx.guild).toBeNull();
    expect(ctx.member).toBeNull();
  });

  it('should provide working option getters', () => {
    const ctx = createMockDeferredContext({
      options: { name: 'test-name', count: 42 },
    });

    expect(ctx.getOption('name')).toBe('test-name');
    expect(ctx.getOption('count')).toBe(42);
    expect(ctx.getOption('missing')).toBeNull();
    expect(ctx.getRequiredOption('name')).toBe('test-name');
    expect(() => ctx.getRequiredOption('missing')).toThrow(
      "Required option 'missing' not provided"
    );
  });

  it('should provide working subcommand getters', () => {
    const ctx = createMockDeferredContext({
      subcommand: 'list',
      subcommandGroup: 'items',
    });

    expect(ctx.getSubcommand()).toBe('list');
    expect(ctx.getSubcommandGroup()).toBe('items');
  });

  it('should have mock response methods', async () => {
    const ctx = createMockDeferredContext();

    await ctx.editReply('test');
    await ctx.followUp('follow up');
    await ctx.deleteReply();

    expect(ctx.editReply).toHaveBeenCalledWith('test');
    expect(ctx.followUp).toHaveBeenCalledWith('follow up');
    expect(ctx.deleteReply).toHaveBeenCalled();
  });

  it('should pass isDeferredContext type guard', () => {
    const ctx = createMockDeferredContext();
    expect(isDeferredContext(ctx as SafeCommandContext)).toBe(true);
    expect(isModalContext(ctx as SafeCommandContext)).toBe(false);
    expect(isManualContext(ctx as SafeCommandContext)).toBe(false);
  });
});

describe('createMockModalContext', () => {
  it('should create context with default values', () => {
    const ctx = createMockModalContext();

    expect(ctx.user.id).toBe('user-123');
    expect(ctx.commandName).toBe('test-command');
  });

  it('should have modal-specific methods', async () => {
    const ctx = createMockModalContext();

    await ctx.showModal({} as Parameters<typeof ctx.showModal>[0]);
    await ctx.reply('error');
    await ctx.deferReply({ ephemeral: true });

    expect(ctx.showModal).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('error');
    expect(ctx.deferReply).toHaveBeenCalledWith({ ephemeral: true });
  });

  it('should NOT have editReply method', () => {
    const ctx = createMockModalContext();
    expect((ctx as unknown as Record<string, unknown>).editReply).toBeUndefined();
  });

  it('should pass isModalContext type guard', () => {
    const ctx = createMockModalContext();
    expect(isDeferredContext(ctx as SafeCommandContext)).toBe(false);
    expect(isModalContext(ctx as SafeCommandContext)).toBe(true);
    expect(isManualContext(ctx as SafeCommandContext)).toBe(false);
  });
});

describe('createMockManualContext', () => {
  it('should create context with default values', () => {
    const ctx = createMockManualContext();

    expect(ctx.user.id).toBe('user-123');
    expect(ctx.commandName).toBe('test-command');
  });

  it('should have all response methods', async () => {
    const ctx = createMockManualContext();

    await ctx.reply('quick response');
    await ctx.deferReply({ ephemeral: false });
    await ctx.editReply('updated');
    await ctx.showModal({} as Parameters<typeof ctx.showModal>[0]);

    expect(ctx.reply).toHaveBeenCalledWith('quick response');
    expect(ctx.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    expect(ctx.editReply).toHaveBeenCalledWith('updated');
    expect(ctx.showModal).toHaveBeenCalled();
  });

  it('should pass isManualContext type guard', () => {
    const ctx = createMockManualContext();
    expect(isDeferredContext(ctx as SafeCommandContext)).toBe(false);
    expect(isModalContext(ctx as SafeCommandContext)).toBe(false);
    expect(isManualContext(ctx as SafeCommandContext)).toBe(true);
  });
});
