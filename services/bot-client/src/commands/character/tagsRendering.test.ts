/**
 * Tests for the shared tag renderer used by both /character view renderers.
 */

import { describe, it, expect } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { formatTagsValue, addTagsEmbedField, tagsBlockText } from './tagsRendering.js';

describe('formatTagsValue', () => {
  it('joins tags with a comma and space', () => {
    expect(formatTagsValue(['fantasy', 'sci-fi'])).toBe('fantasy, sci-fi');
  });

  it('returns null for an empty array', () => {
    expect(formatTagsValue([])).toBeNull();
  });

  it('returns null for undefined (write-path CharacterData omits the field)', () => {
    expect(formatTagsValue(undefined)).toBeNull();
  });

  it('escapes markdown so a tag cannot inject formatting', () => {
    expect(formatTagsValue(['*bold*'])).toBe('\\*bold\\*');
  });
});

describe('addTagsEmbedField', () => {
  it('adds a Tags field when there are tags', () => {
    const embed = new EmbedBuilder();
    addTagsEmbedField(['fantasy', 'sci-fi'], embed);

    const field = embed.toJSON().fields?.[0];
    expect(field?.name).toContain('Tags');
    expect(field?.value).toBe('fantasy, sci-fi');
    expect(field?.inline).toBe(false);
  });

  it('adds nothing when there are no tags', () => {
    const embed = new EmbedBuilder();
    addTagsEmbedField([], embed);
    expect(embed.toJSON().fields).toBeUndefined();
  });
});

describe('tagsBlockText', () => {
  it('renders a bold heading above the joined tags', () => {
    expect(tagsBlockText(['fantasy'])).toBe('**🏷️ Tags**\nfantasy');
  });

  it('returns null when there are no tags', () => {
    expect(tagsBlockText([])).toBeNull();
    expect(tagsBlockText(undefined)).toBeNull();
  });

  it('uses the SAME label as the embed field, so a kill-switch flip is invisible', () => {
    const embed = new EmbedBuilder();
    addTagsEmbedField(['fantasy'], embed);
    const embedLabel = embed.toJSON().fields?.[0]?.name ?? '';

    expect(tagsBlockText(['fantasy'])).toBe(`**${embedLabel}**\nfantasy`);
  });
});
