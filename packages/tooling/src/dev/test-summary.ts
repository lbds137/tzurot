/**
 * Test Summary Runner
 *
 * Runs tests and outputs a clean summary of results.
 * Filters out all the noise and shows just the pass/fail counts.
 */

import { spawnSync } from 'node:child_process';

// ANSI escape code regex for stripping colors
// eslint-disable-next-line no-control-regex -- ANSI escape stripping requires control characters
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

const SEPARATOR = '\x1b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m';

/** Extract test summary lines from turbo output */
function extractSummaryLines(output: string): string[] {
  const lines = output.split('\n');
  const summaryLines: string[] = [];
  let currentPackage = '';

  for (const line of lines) {
    const packageMatch = /@tzurot\/([a-z-]+):test:/.exec(line);
    if (packageMatch) {
      currentPackage = packageMatch[1];
    }

    const cleanLine = line.replace(ANSI_REGEX, '');
    const summaryMatch = /(Test Files|Tests)\s+(\d|passed|failed)/.exec(cleanLine);
    if (summaryMatch !== null && currentPackage !== '') {
      const colonIndex = cleanLine.lastIndexOf(':');
      const summaryPart =
        colonIndex !== -1 ? cleanLine.slice(colonIndex + 1).trim() : cleanLine.trim();
      summaryLines.push(`${currentPackage}: ${summaryPart}`);
    }
  }

  return summaryLines;
}

/** Print grouped test results */
function printSummary(summaryLines: string[]): void {
  if (summaryLines.length === 0) {
    console.log('\x1b[33mNo test results found.\x1b[0m');
    return;
  }

  const packages = new Map<string, string[]>();
  for (const line of summaryLines) {
    const [pkg, ...rest] = line.split(': ');
    const existing = packages.get(pkg) ?? [];
    existing.push(rest.join(': '));
    packages.set(pkg, existing);
  }

  for (const [pkg, pkgLines] of packages) {
    const hasFailed = pkgLines.some(l => l.includes('failed'));
    const color = hasFailed ? '\x1b[31m' : '\x1b[32m';
    const icon = hasFailed ? '✗' : '✓';

    console.log(`${color}${icon} ${pkg}\x1b[0m`);
    for (const pkgLine of pkgLines) {
      console.log(`  ${pkgLine}`);
    }
    console.log('');
  }
}

/**
 * Run tests and show a clean summary
 */
export function runTestSummary(): void {
  console.log('\x1b[36m› Running tests...\x1b[0m\n');

  const result = spawnSync('turbo', ['run', 'test'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
    encoding: 'utf-8',
  });

  if (result.error) {
    console.error('\x1b[31mError running turbo:\x1b[0m', result.error.message);
    process.exit(1);
  }

  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const summaryLines = extractSummaryLines(output);

  console.log(SEPARATOR);
  console.log('\x1b[36m                TEST SUMMARY              \x1b[0m');
  console.log(`${SEPARATOR}\n`);

  printSummary(summaryLines);

  console.log(SEPARATOR);

  const exitCode = result.status ?? 0;
  if (exitCode !== 0) {
    console.log(`\n\x1b[31mTests failed. Run 'pnpm test:failures' for details.\x1b[0m`);
  }
  process.exit(exitCode);
}
