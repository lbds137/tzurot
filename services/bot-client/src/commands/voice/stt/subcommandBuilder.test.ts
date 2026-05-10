/**
 * Tests for the /voice stt subcommand group builder.
 * STT is user-scoped: just set / clear, no per-personality dimension.
 */

import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { buildVoiceSttSubcommandGroup } from './subcommandBuilder.js';

function buildJson() {
  const builder = new SlashCommandBuilder().setName('test').setDescription('test');
  builder.addSubcommandGroup(group => buildVoiceSttSubcommandGroup(group));
  return builder.toJSON();
}

describe('buildVoiceSttSubcommandGroup', () => {
  it('attaches just set + clear (no per-personality variants)', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );

    expect(sttGroup).toBeDefined();
    expect(sttGroup?.options?.length).toBe(2);
    const names = (sttGroup?.options as { name: string }[] | undefined)?.map(s => s.name);
    expect(names).toEqual(['set', 'clear']);
  });

  it('set requires a provider (static choices for the 3 STT providers)', () => {
    const json = buildJson();
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const setSub = (sttGroup?.options as { name: string; options?: unknown[] }[] | undefined)?.find(
      s => s.name === 'set'
    );
    const opts = setSub?.options as
      | { name: string; required?: boolean; choices?: { value: string }[] }[]
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
    const sttGroup = json.options?.find(
      (o): o is typeof o & { options?: unknown[] } => o.name === 'stt'
    );
    const clearSub = (
      sttGroup?.options as { name: string; options?: unknown[] }[] | undefined
    )?.find(s => s.name === 'clear');

    expect(clearSub?.options ?? []).toEqual([]);
  });
});
