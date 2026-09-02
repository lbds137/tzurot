import { describe, it, expect } from 'vitest';
import { formatAttachmentEntry } from './attachmentEntry.js';

describe('formatAttachmentEntry', () => {
  it('renders the plain description-only line when attribution is null (placeholder / non-image)', () => {
    const text = formatAttachmentEntry(
      { description: 'Attachment type not supported', attribution: null },
      0
    );
    expect(text).toBe('1. Attachment type not supported');
  });

  it('renders a Model line with no routing when routedModel is absent', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a photo of a cat',
        attribution: { model: 'qwen/qwen3.5-397b-a17b', fromCache: false },
      },
      0
    );
    expect(text).toBe('1. a photo of a cat\n   Model: qwen/qwen3.5-397b-a17b');
  });

  it('renders the routed arm when routedModel differs from the requested model', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a photo of a cat',
        attribution: {
          model: 'openrouter/auto',
          routedModel: 'google/gemini-2.5-flash',
          fromCache: false,
        },
      },
      0
    );
    expect(text).toBe(
      '1. a photo of a cat\n   Model: openrouter/auto → google/gemini-2.5-flash (routed)'
    );
  });

  it('renders the cached arm when fromCache is true', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a photo of a cat',
        attribution: { model: 'qwen/qwen3.5-397b-a17b', fromCache: true },
      },
      0
    );
    expect(text).toBe('1. a photo of a cat\n   Model: qwen/qwen3.5-397b-a17b (cached)');
  });

  it('renders the description alone when the cached arm has no recorded model', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a photo of a cat',
        attribution: { model: '', fromCache: true },
      },
      0
    );
    expect(text).toBe('1. a photo of a cat');
  });

  it('does not render a routed arm when routedModel equals the requested model', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a photo of a cat',
        attribution: {
          model: 'qwen/qwen3.5-397b-a17b',
          routedModel: 'qwen/qwen3.5-397b-a17b',
          fromCache: false,
        },
      },
      0
    );
    expect(text).toBe('1. a photo of a cat\n   Model: qwen/qwen3.5-397b-a17b');
  });

  it('escapes fence breaks in the description and model names', () => {
    const text = formatAttachmentEntry(
      {
        description: 'a ``` fenced description',
        attribution: { model: 'qwen/qwen3.5-397b-a17b', fromCache: false },
      },
      2
    );
    expect(text).not.toContain('```');
    expect(text.startsWith('3. ')).toBe(true);
  });

  it('numbers using the 1-based index parameter', () => {
    const text = formatAttachmentEntry({ description: 'second item', attribution: null }, 1);
    expect(text).toBe('2. second item');
  });

  it('renders a bare-string entry (legacy JSONB shape) as description-only, with no Model line', () => {
    const text = formatAttachmentEntry('a legacy description', 0);
    expect(text).toBe('1. a legacy description');
    expect(text).not.toContain('Model:');
  });
});
