/**
 * Tests for the pure workflow-job → status-check-context expansion that
 * main-required-checks.ts builds its evaluation on.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseWorkflowContexts, expandJobContexts } from './workflow-job-contexts.js';

describe('parseWorkflowContexts', () => {
  const FIXTURE =
    'name: CI\non:\n  push:\n    branches: [main]\n  workflow_dispatch: {}\njobs:\n' +
    '  fixup-check:\n    runs-on: ubuntu-latest\n  lint:\n    runs-on: ubuntu-latest\n' +
    '  unit-tests:\n    runs-on: ubuntu-latest\n';

  it('reads only the top-level jobs mapping keys, not a sibling like on/push', () => {
    const contexts = parseWorkflowContexts(FIXTURE);
    expect([...contexts.keys()]).toEqual(['fixup-check', 'lint', 'unit-tests']);
  });

  it('throws when the document has no jobs mapping', () => {
    expect(() => parseWorkflowContexts('name: CI\non: push\n')).toThrow();
  });

  it('throws on a document with no mapping at all', () => {
    expect(() => parseWorkflowContexts('[]')).toThrow();
  });

  it("the checked-out ci.yml's unit-tests/lint jobs expand to their live contexts", () => {
    const path = fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url));
    const contexts = parseWorkflowContexts(readFileSync(path, 'utf-8'));

    expect(contexts.get('unit-tests')).toEqual([
      'unit-tests (bot-client)',
      'unit-tests (ai-worker)',
      'unit-tests (api-gateway)',
      'unit-tests (website)',
      'unit-tests (tooling)',
      'unit-tests (packages)',
    ]);
    expect(contexts.get('lint')).toEqual(['lint']);
  });
});

describe('expandJobContexts', () => {
  it('a no-matrix job with a literal name uses that name', () => {
    expect(expandJobContexts('lint-all', { name: 'Lint all' })).toEqual(['Lint all']);
  });

  it('a no-matrix job whose name is a non-matrix expression falls back to the job id', () => {
    expect(expandJobContexts('deploy', { name: '${{ github.ref }}' })).toEqual(['deploy']);
  });

  it('a no-matrix job with no name falls back to the job id', () => {
    expect(expandJobContexts('build', {})).toEqual(['build']);
  });

  it('a job whose value is not a plain object falls back to the job id', () => {
    expect(expandJobContexts('weird', 'not an object')).toEqual(['weird']);
  });

  it('expands an include-only matrix with a name template, in include order', () => {
    const job = {
      name: 'unit-tests (${{ matrix.cell }})',
      strategy: {
        matrix: {
          include: [
            { cell: 'a', filter: '--filter=a' },
            { cell: 'b', filter: '--filter=b' },
          ],
        },
      },
    };
    expect(expandJobContexts('unit-tests', job)).toEqual(['unit-tests (a)', 'unit-tests (b)']);
  });

  // The `<job id> (<values joined by ', '>)` shape is observed, not recalled: this repository's
  // PR check lists carry `docker-build-smoke (voice-engine, services/voice-engine)` and
  // `docker-build-smoke (website, ., --build-arg SITE_BRAND=rotzot, -rotzot)`, produced by
  // main's nameless include-only `docker-build-smoke` matrix, values in include-key order.
  it("expands a nameless include-only matrix using GitHub's default naming", () => {
    const job = {
      strategy: {
        matrix: {
          include: [
            { service: 'ai-worker', context: '.' },
            { service: 'website', context: '.', args: '--x' },
          ],
        },
      },
    };
    expect(expandJobContexts('docker-build-smoke', job)).toEqual([
      'docker-build-smoke (ai-worker, .)',
      'docker-build-smoke (website, ., --x)',
    ]);
  });

  it('expands plain axes as a cartesian product in axis-key order', () => {
    const job = { strategy: { matrix: { os: ['ubuntu', 'windows'], node: [20, 24] } } };
    expect(expandJobContexts('j', job)).toEqual([
      'j (ubuntu, 20)',
      'j (ubuntu, 24)',
      'j (windows, 20)',
      'j (windows, 24)',
    ]);
  });

  it('a name template referencing a key the entry lacks falls back to the job id for that entry', () => {
    const job = {
      name: 'unit-tests (${{ matrix.cell }})',
      strategy: { matrix: { include: [{ other: 'a' }] } },
    };
    expect(expandJobContexts('unit-tests', job)).toEqual(['unit-tests']);
  });

  it('a name template leaving a non-matrix expression after substitution falls back to the job id', () => {
    const job = {
      name: 'unit-tests (${{ matrix.cell }}) ${{ github.sha }}',
      strategy: { matrix: { include: [{ cell: 'a' }] } },
    };
    expect(expandJobContexts('unit-tests', job)).toEqual(['unit-tests']);
  });

  it('an expression-valued matrix (a string) is not evaluated — known gap', () => {
    const job = { strategy: { matrix: '${{ fromJSON(needs.x.outputs.m) }}' } };
    expect(expandJobContexts('dynamic', job)).toEqual(['dynamic']);
  });

  it('an empty matrix object falls back to the job id', () => {
    expect(expandJobContexts('empty', { strategy: { matrix: {} } })).toEqual(['empty']);
  });

  it('a matrix with exclude falls back to the job id — known gap, loud', () => {
    const job = { strategy: { matrix: { os: ['a', 'b'], exclude: [{ os: 'b' }] } } };
    expect(expandJobContexts('j', job)).toEqual(['j']);
  });
});
