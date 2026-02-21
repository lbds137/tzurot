/**
 * Tests for shared import validation helpers
 */

import { describe, it, expect } from 'vitest';
import { getImportedFieldsList, getMissingRequiredFields } from './importValidation.js';

describe('getImportedFieldsList', () => {
  const fieldDefs = [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description' },
    { key: 'model', label: 'Model' },
  ];

  it('should return labels for fields present in payload', () => {
    const payload = { name: 'test', model: 'gpt-4' };
    expect(getImportedFieldsList(payload, fieldDefs)).toEqual(['Name', 'Model']);
  });

  it('should exclude null values', () => {
    const payload = { name: 'test', description: null, model: 'gpt-4' };
    expect(getImportedFieldsList(payload, fieldDefs)).toEqual(['Name', 'Model']);
  });

  it('should exclude undefined values', () => {
    const payload = { name: 'test' };
    expect(getImportedFieldsList(payload, fieldDefs)).toEqual(['Name']);
  });

  it('should return empty array when no fields match', () => {
    const payload = {};
    expect(getImportedFieldsList(payload, fieldDefs)).toEqual([]);
  });

  it('should include fields with falsy but non-null/undefined values', () => {
    const payload = { name: '', description: 0, model: false };
    expect(getImportedFieldsList(payload, fieldDefs)).toEqual(['Name', 'Description', 'Model']);
  });
});

describe('getMissingRequiredFields', () => {
  const requiredFields = ['name', 'slug', 'characterInfo'];

  it('should return empty array when all required fields present', () => {
    const data = { name: 'test', slug: 'test', characterInfo: 'info' };
    expect(getMissingRequiredFields(data, requiredFields)).toEqual([]);
  });

  it('should return missing field keys', () => {
    const data = { name: 'test' };
    expect(getMissingRequiredFields(data, requiredFields)).toEqual(['slug', 'characterInfo']);
  });

  it('should treat null as missing', () => {
    const data = { name: 'test', slug: null, characterInfo: 'info' };
    expect(getMissingRequiredFields(data, requiredFields)).toEqual(['slug']);
  });

  it('should treat empty string as missing', () => {
    const data = { name: '', slug: 'test', characterInfo: 'info' };
    expect(getMissingRequiredFields(data, requiredFields)).toEqual(['name']);
  });

  it('should treat undefined as missing', () => {
    const data = { slug: 'test', characterInfo: 'info' };
    expect(getMissingRequiredFields(data, requiredFields)).toEqual(['name']);
  });

  it('should return all fields when data is empty', () => {
    expect(getMissingRequiredFields({}, requiredFields)).toEqual(requiredFields);
  });
});
