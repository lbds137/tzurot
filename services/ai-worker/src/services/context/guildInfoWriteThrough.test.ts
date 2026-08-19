import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordActiveGuildInfo,
  recordParticipantGuildInfo,
  type GuildMemberInfoRecorder,
} from './guildInfoWriteThrough.js';

const GUILD = '123456789012345678';
const INFO = { roles: ['Admin'], displayColor: '#FF00FF' };

describe('recordActiveGuildInfo', () => {
  let record: GuildMemberInfoRecorder['record'];

  beforeEach(() => {
    record = vi.fn<GuildMemberInfoRecorder['record']>().mockResolvedValue(undefined);
  });

  it('records the observation against the internal user id', async () => {
    await recordActiveGuildInfo({ record }, GUILD, 'internal-1', INFO);

    expect(record).toHaveBeenCalledWith(GUILD, [{ userId: 'internal-1', info: INFO }]);
  });

  it('records nothing in a DM', async () => {
    await recordActiveGuildInfo({ record }, null, 'internal-1', INFO);

    expect(record).not.toHaveBeenCalled();
  });

  it('records nothing when the envelope carried no observation', async () => {
    await recordActiveGuildInfo({ record }, GUILD, 'internal-1', undefined);

    expect(record).not.toHaveBeenCalled();
  });
});

describe('recordParticipantGuildInfo', () => {
  let record: GuildMemberInfoRecorder['record'];

  beforeEach(() => {
    record = vi.fn<GuildMemberInfoRecorder['record']>().mockResolvedValue(undefined);
  });

  it('translates discord-prefixed keys through the user map', async () => {
    await recordParticipantGuildInfo(
      { record },
      { 'discord:555': INFO },
      GUILD,
      new Map([['555', 'internal-555']])
    );

    expect(record).toHaveBeenCalledWith(GUILD, [{ userId: 'internal-555', info: INFO }]);
  });

  it('accepts a bare snowflake key as well as a prefixed one', async () => {
    // The bot writes prefixed keys, but the map is only "unremapped" by
    // convention — a bare id must not silently drop the observation.
    await recordParticipantGuildInfo(
      { record },
      { '555': INFO },
      GUILD,
      new Map([['555', 'internal-555']])
    );

    expect(record).toHaveBeenCalledWith(GUILD, [{ userId: 'internal-555', info: INFO }]);
  });

  it('drops a key the user map never provisioned', async () => {
    // Bots and malformed snowflakes are filtered before provisioning; guessing
    // a user id here would attach a stranger's roles to somebody else.
    await recordParticipantGuildInfo({ record }, { 'discord:555': INFO }, GUILD, new Map());

    expect(record).toHaveBeenCalledWith(GUILD, []);
  });

  it('records nothing in a DM, or when the envelope carried no map', async () => {
    await recordParticipantGuildInfo({ record }, { 'discord:555': INFO }, null, new Map());
    await recordParticipantGuildInfo({ record }, undefined, GUILD, new Map());

    expect(record).not.toHaveBeenCalled();
  });
});
