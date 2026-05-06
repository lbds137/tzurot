/**
 * Tests for the truncation-gate detection primitive.
 *
 * Generic over the data type — these tests use a synthetic field shape
 * to confirm the function works against any `T`, independent of any
 * specific dashboard's data type.
 */

import { describe, it, expect } from 'vitest';
import { detectOverLengthFields } from './detection.js';
import { SectionStatus } from '../types.js';

interface SyntheticData {
  title: string;
  body: string;
}

const syntheticSection = {
  id: 'synthetic',
  label: '🔬 Synthetic',
  description: 'test',
  fieldIds: ['title', 'body'],
  fields: [
    { id: 'title', label: 'Title', maxLength: 100, style: 'short' as const },
    { id: 'body', label: 'Body', maxLength: 1000, style: 'paragraph' as const },
  ],
  getStatus: () => SectionStatus.DEFAULT,
  getPreview: () => '',
};

describe('detectOverLengthFields', () => {
  it('returns empty when no field exceeds its maxLength', () => {
    const data: SyntheticData = { title: 'short', body: 'also short' };
    expect(detectOverLengthFields(syntheticSection, data)).toEqual([]);
  });

  it('flags a field whose value exceeds the cap', () => {
    const data: SyntheticData = { title: 'x'.repeat(150), body: 'ok' };
    const result = detectOverLengthFields(syntheticSection, data);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      fieldId: 'title',
      label: 'Title',
      current: 150,
      max: 100,
    });
  });

  it('flags multiple over-cap fields independently', () => {
    const data: SyntheticData = { title: 'x'.repeat(150), body: 'y'.repeat(1500) };
    const result = detectOverLengthFields(syntheticSection, data);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.fieldId).sort()).toEqual(['body', 'title']);
  });

  it('ignores non-string values and missing fields', () => {
    const data = {
      title: null,
      body: undefined,
      unrelated: 'x'.repeat(5000),
    } as unknown as SyntheticData;
    expect(detectOverLengthFields(syntheticSection, data)).toEqual([]);
  });

  it('is generic over T (independent of any specific dashboard type)', () => {
    interface DifferentShape {
      alpha: string;
    }
    const otherSection = {
      id: 'other',
      label: 'Other',
      description: 'test',
      fieldIds: ['alpha'],
      fields: [{ id: 'alpha', label: 'Alpha', maxLength: 5, style: 'short' as const }],
      getStatus: () => SectionStatus.DEFAULT,
      getPreview: () => '',
    };
    const data: DifferentShape = { alpha: 'too long for cap' };
    const result = detectOverLengthFields(otherSection, data);
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe('alpha');
  });
});
