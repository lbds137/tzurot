import { describe, it, expect } from 'vitest';
import { buildModelCompatibilityEmbed } from './warningsEmbed.js';

describe('buildModelCompatibilityEmbed', () => {
  it('returns null for an empty warnings array so callers skip the followUp', () => {
    expect(buildModelCompatibilityEmbed([])).toBeNull();
  });

  it('renders each warning as a bullet in a warning embed', () => {
    const embed = buildModelCompatibilityEmbed(['first warning', 'second warning']);
    expect(embed).not.toBeNull();
    const data = embed?.toJSON();
    expect(data?.title).toBe('⚠️ Model Compatibility');
    expect(data?.description).toBe('• first warning\n• second warning');
  });

  it('escapes markdown in warning text so a crafted model name cannot break the embed', () => {
    // The gateway interpolates the user-supplied model string into its warning
    // prose; the model field is a free-form string, so markdown metacharacters
    // must not survive into the embed unescaped.
    const embed = buildModelCompatibilityEmbed([
      `Model '*evil*/\`model\`' cannot disable thinking`,
    ]);
    const description = embed?.toJSON().description ?? '';
    expect(description).toContain('\\*evil\\*');
    expect(description).toContain('\\`model\\`');
    expect(description).not.toContain('*evil*');
  });
});
