/**
 * Tests for the codegen orchestrator.
 *
 * Uses a temp directory (rather than mocking node:fs) because runCodegen
 * imports fs at module top-level — late vi.doMock wouldn't reroute it.
 * Tempdir is fast enough for unit tests and gives us real filesystem
 * semantics for the write + drift-detection paths.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAllClients, runCodegen, summarizeManifest } from './routes.js';

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'codegen-test-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('summarizeManifest', () => {
  it('reports a non-zero total across all three audiences', () => {
    const summary = summarizeManifest();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.internal).toBeGreaterThan(0);
    expect(summary.admin).toBeGreaterThan(0);
    expect(summary.user).toBeGreaterThan(0);
    expect(summary.total).toBe(summary.internal + summary.admin + summary.user);
  });
});

describe('generateAllClients', () => {
  it('emits four files keyed by output path', () => {
    const files = generateAllClients();
    const paths = Object.keys(files);
    expect(paths).toHaveLength(4);
    expect(paths.some(p => p.endsWith('/service-client.ts'))).toBe(true);
    expect(paths.some(p => p.endsWith('/owner-client.ts'))).toBe(true);
    expect(paths.some(p => p.endsWith('/user-client.ts'))).toBe(true);
    expect(paths.some(p => p.endsWith('/mounts.ts'))).toBe(true);
  });

  it('every generated file has the AUTO-GENERATED header', () => {
    const files = generateAllClients();
    for (const src of Object.values(files)) {
      expect(src).toContain('AUTO-GENERATED FILE');
    }
  });

  it('ServiceClient exports the class definition', () => {
    const files = generateAllClients();
    const serviceClient =
      files[Object.keys(files).find(p => p.endsWith('/service-client.ts')) as string];
    expect(serviceClient).toContain('export class ServiceClient');
    expect(serviceClient).toContain('ServiceClientOptions');
  });

  it('OwnerClient exports + has actor field', () => {
    const files = generateAllClients();
    const ownerClient =
      files[Object.keys(files).find(p => p.endsWith('/owner-client.ts')) as string];
    expect(ownerClient).toContain('export class OwnerClient');
    expect(ownerClient).toContain('actor: ActorDiscordId');
  });

  it('UserClient exports + has actor + user fields', () => {
    const files = generateAllClients();
    const userClient = files[Object.keys(files).find(p => p.endsWith('/user-client.ts')) as string];
    expect(userClient).toContain('export class UserClient');
    expect(userClient).toContain('actor: ActorDiscordId');
    expect(userClient).toContain('user: GatewayUser');
  });

  it('all generated method IDs match the manifest IDs (no name drift)', () => {
    const files = generateAllClients();
    const summary = summarizeManifest();
    const totalMethods = Object.values(files).reduce((acc, src) => {
      // Count `async <id>(` occurrences (excluding the helper line)
      const matches = src.matchAll(/^ {2}async (\w+)\(/gm);
      return acc + [...matches].length;
    }, 0);
    expect(totalMethods).toBe(summary.total);
  });
});

describe('runCodegen (write path)', () => {
  it('writes all three client files into the rootDir', () => {
    const result = runCodegen({ rootDir: tempRoot });
    expect(result.upToDate).toBe(true);
    expect(result.drifted).toEqual([]);
    expect(Object.keys(result.files)).toHaveLength(4);

    for (const path of Object.keys(result.files)) {
      const content = readFileSync(path, 'utf-8');
      expect(content).toContain('AUTO-GENERATED FILE');
    }
  });

  it('creates the _generated directory if it does not exist', () => {
    runCodegen({ rootDir: tempRoot });
    // mkdirSync recursive should have created the nested dir
    const generated = readFileSync(
      join(tempRoot, 'packages/clients/src/clients/_generated/service-client.ts'),
      'utf-8'
    );
    expect(generated).toContain('export class ServiceClient');
  });
});

describe('runCodegen (drift detection)', () => {
  it('reports no drift when on-disk content matches generator output', () => {
    runCodegen({ rootDir: tempRoot });
    const checkResult = runCodegen({ rootDir: tempRoot, check: true });
    expect(checkResult.upToDate).toBe(true);
    expect(checkResult.drifted).toEqual([]);
  });

  it('reports drift for every file when nothing is on disk', () => {
    const checkResult = runCodegen({ rootDir: tempRoot, check: true });
    expect(checkResult.upToDate).toBe(false);
    expect(checkResult.drifted).toHaveLength(4);
    expect(checkResult.drifted.every(p => p.endsWith('.ts'))).toBe(true);
  });

  it('reports drift only for files that have been hand-edited', () => {
    runCodegen({ rootDir: tempRoot });
    const ownerPath = join(tempRoot, 'packages/clients/src/clients/_generated/owner-client.ts');
    writeFileSync(ownerPath, '// hand-edited content\n');

    const checkResult = runCodegen({ rootDir: tempRoot, check: true });
    expect(checkResult.upToDate).toBe(false);
    expect(checkResult.drifted).toEqual([ownerPath]);
  });

  it('check mode does not overwrite files even when they drift', () => {
    runCodegen({ rootDir: tempRoot });
    const userPath = join(tempRoot, 'packages/clients/src/clients/_generated/user-client.ts');
    const handEditedContent = '// hand-edited\n';
    writeFileSync(userPath, handEditedContent);

    runCodegen({ rootDir: tempRoot, check: true });
    expect(readFileSync(userPath, 'utf-8')).toBe(handEditedContent);
  });

  it('write mode overwrites drifted files (the regen path)', () => {
    mkdirSync(join(tempRoot, 'packages/clients/src/clients/_generated'), {
      recursive: true,
    });
    const ownerPath = join(tempRoot, 'packages/clients/src/clients/_generated/owner-client.ts');
    writeFileSync(ownerPath, '// stale content');

    runCodegen({ rootDir: tempRoot });
    const newContent = readFileSync(ownerPath, 'utf-8');
    expect(newContent).toContain('export class OwnerClient');
    expect(newContent).not.toBe('// stale content');
  });
});
