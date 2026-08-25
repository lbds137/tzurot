/**
 * Tests for the export-smoke validator's per-file JSON schema + `.md`
 * emptiness checks.
 */

import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { validateJsonAndMdFiles } from './exportSmokeSchemaChecks.js';

describe('exportSmokeSchemaChecks validateJsonAndMdFiles', () => {
  it('reports no findings for a valid json file and a non-empty md file', () => {
    const files: Record<string, Uint8Array> = {
      'feedback.json': strToU8('[]'),
      'README.md': strToU8('hello'),
    };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings).toEqual([]);
  });

  it('reports a finding when a json file fails to parse', () => {
    const files: Record<string, Uint8Array> = { 'feedback.json': strToU8('not json') };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings).toContain('json-parse: feedback.json failed to parse');
  });

  it('reports a finding when a json path is not recognized by the content-schema map', () => {
    const files: Record<string, Uint8Array> = { 'unknown/path.json': strToU8('{}') };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings).toContain('json-schema: unknown/path.json is an unrecognized json path');
  });

  it('CANARY: reports a finding when a json file fails its content-schema validation', () => {
    const files: Record<string, Uint8Array> = {
      'feedback.json': strToU8(JSON.stringify([{ unexpectedKey: 'x' }])),
    };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings.some(f => f.startsWith('json-schema: feedback.json failed validation'))).toBe(
      true
    );
  });

  it('never includes the Zod issue value inside a schema-failure finding', () => {
    const files: Record<string, Uint8Array> = {
      'feedback.json': strToU8(JSON.stringify([{ secretLookingField: 'sk-topsecret-value' }])),
    };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings.join('\n')).not.toContain('sk-topsecret-value');
  });

  it('CANARY: reports a finding when a md file is empty', () => {
    const files: Record<string, Uint8Array> = { 'README.md': strToU8('   ') };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings).toContain('md-empty: README.md is empty');
  });

  it('ignores files that are neither .json nor .md', () => {
    const files: Record<string, Uint8Array> = { 'binary.dat': strToU8('anything') };
    const findings: string[] = [];
    validateJsonAndMdFiles(files, findings);
    expect(findings).toEqual([]);
  });
});
