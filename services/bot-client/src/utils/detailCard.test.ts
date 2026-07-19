/**
 * Tests for the entity detail-card scaffold (G5).
 *
 * Assertions run over `toJSON()` so discord.js's own component validation
 * participates in every case.
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { buildEntityDetailCard } from './detailCard.js';

interface EmbedJson {
  title?: string;
  color?: number;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

function toJson(card: ReturnType<typeof buildEntityDetailCard>): EmbedJson {
  return card.embed.toJSON() as EmbedJson;
}

describe('buildEntityDetailCard', () => {
  it('applies defaults: BLURPLE, no footer, no timestamp, no description', () => {
    const card = buildEntityDetailCard({ title: '📄 Thing Details' });
    const json = toJson(card);

    expect(json.title).toBe('📄 Thing Details');
    expect(json.color).toBe(DISCORD_COLORS.BLURPLE);
    expect(json.description).toBeUndefined();
    expect(json.fields).toBeUndefined();
    expect(json.footer).toBeUndefined();
    expect(json.timestamp).toBeUndefined();
    expect(card.descriptionTruncated).toBe(false);
  });

  it('carries state-derived color, footer, and timestamp through', () => {
    const json = toJson(
      buildEntityDetailCard({
        title: '🔒 Thing Details',
        color: DISCORD_COLORS.WARNING,
        footer: 'Thing ID: abc12345...',
        timestamp: true,
      })
    );

    expect(json.color).toBe(DISCORD_COLORS.WARNING);
    expect(json.footer?.text).toBe('Thing ID: abc12345...');
    expect(json.timestamp).toBeDefined();
  });

  it('skips null/undefined/false field slots (conditional-field idiom)', () => {
    const json = toJson(
      buildEntityDetailCard({
        title: 'T',
        fields: [
          { name: 'Always', value: 'yes', inline: true },
          null,
          undefined,
          false,
          { name: 'Also', value: 'yes' },
        ],
      })
    );

    expect(json.fields?.map(f => f.name)).toEqual(['Always', 'Also']);
    // inline defaults to false when omitted
    expect(json.fields?.[1].inline).toBe(false);
  });

  it("expands 'spacer' slots into invisible inline grid cells", () => {
    const json = toJson(
      buildEntityDetailCard({
        title: 'T',
        fields: [
          { name: 'A', value: '1', inline: true },
          { name: 'B', value: '2', inline: true },
          'spacer',
          { name: 'C', value: '3', inline: true },
        ],
      })
    );

    expect(json.fields?.[2]).toEqual({ name: '\u200B', value: '\u200B', inline: true });
    expect(json.fields).toHaveLength(4);
  });

  it('leaves an under-cap description untouched', () => {
    const card = buildEntityDetailCard({
      title: 'T',
      description: 'short content',
      descriptionCap: 100,
      truncationNotice: '\n\n*truncated*',
    });

    expect(toJson(card).description).toBe('short content');
    expect(card.descriptionTruncated).toBe(false);
  });

  it('cuts an over-cap description to fit the notice and flips the flag', () => {
    const card = buildEntityDetailCard({
      title: 'T',
      description: 'x'.repeat(120),
      descriptionCap: 100,
      truncationNotice: '\n\n*truncated*',
    });
    const description = toJson(card).description ?? '';

    expect(card.descriptionTruncated).toBe(true);
    expect(description.endsWith('\n\n*truncated*')).toBe(true);
    // cut + notice together stay within the cap
    expect([...description].length).toBeLessThanOrEqual(100);
  });

  it('truncates by code point so an astral char at the boundary never splits', () => {
    const notice = '…';
    const card = buildEntityDetailCard({
      title: 'T',
      description: '🎭'.repeat(60), // 60 code points, 120 UTF-16 units
      descriptionCap: 50,
      truncationNotice: notice,
    });
    const description = toJson(card).description ?? '';

    expect(card.descriptionTruncated).toBe(true);
    // No lone surrogate: every remaining char is the full emoji or the notice
    expect([...description.slice(0, -notice.length)].every(c => c === '🎭')).toBe(true);
    expect([...description].length).toBe(50);
  });

  it('treats an empty description as absent', () => {
    const json = toJson(buildEntityDetailCard({ title: 'T', description: '' }));
    expect(json.description).toBeUndefined();
  });
});
