/**
 * Tests for the /voice provider subcommand group builder.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceProviderSubcommandGroup } from './subcommandBuilder.js';

function buildJson() {
  const builder = new SlashCommandBuilder().setName('test').setDescription('test');
  builder.addSubcommandGroup(group => buildVoiceProviderSubcommandGroup(group));
  return builder.toJSON();
}

describe('buildVoiceProviderSubcommandGroup', () => {
  it('attaches set + clear subcommands', () => {
    const json = buildJson();
    const providerGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'provider'
    );

    expect(providerGroup).toBeDefined();
    expect(providerGroup?.options?.length).toBe(2);
    const names = (providerGroup?.options as Array<{ name: string }> | undefined)?.map(s => s.name);
    expect(names).toEqual(['set', 'clear']);
  });

  it('set takes a required provider option with all 3 STT_PROVIDERS as choices', () => {
    const json = buildJson();
    const providerGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'provider'
    );
    const setSub = (
      providerGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'set');
    const opts = setSub?.options as
      | Array<{ name: string; required?: boolean; choices?: Array<{ value: string }> }>
      | undefined;

    expect(opts?.length).toBe(1);
    const provider = opts?.[0];
    expect(provider?.name).toBe('provider');
    expect(provider?.required).toBe(true);
    expect(provider?.choices?.map(c => c.value).sort()).toEqual(
      ['elevenlabs', 'mistral', 'voice-engine'].sort()
    );
  });

  it('clear takes no options', () => {
    const json = buildJson();
    const providerGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'provider'
    );
    const clearSub = (
      providerGroup?.options as Array<{ name: string; options?: unknown[] }> | undefined
    )?.find(s => s.name === 'clear');

    expect(clearSub?.options ?? []).toEqual([]);
  });
});
