/**
 * Generate PGLite Schema
 *
 * Regenerate PGLite schema SQL from Prisma schema.
 * Run this whenever you change prisma/schema.prisma.
 *
 * Ported from scripts/testing/regenerate-pglite-schema.sh
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/**
 * Dummy DATABASE_URL - Prisma doesn't actually connect for migrate diff,
 * just needs a valid-looking URL to identify the provider.
 * Using minimal format to avoid secretlint false positives.
 */
const DUMMY_DATABASE_URL = 'postgres://x:x@x/x';

export interface GenerateSchemaOptions {
  output?: string;
}

/**
 * Generate PGLite-compatible SQL schema from Prisma
 */
export async function generateSchema(options: GenerateSchemaOptions = {}): Promise<void> {
  const rootDir = process.cwd();
  const outputPath = options.output ?? join(rootDir, 'tests', 'schema', 'pglite-schema.sql');

  console.log(chalk.cyan('Generating PGLite schema from Prisma...'));

  try {
    // Set dummy DATABASE_URL if not already set
    const env = {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? DUMMY_DATABASE_URL,
    };

    // Run prisma migrate diff using execFileSync (no shell injection)
    const schemaPath = join(rootDir, 'prisma', 'schema.prisma');
    const sql = execFileSync(
      'npx',
      ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script'],
      {
        encoding: 'utf-8',
        env,
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr
      }
    );

    // Write output
    writeFileSync(outputPath, sql);

    // Count lines
    const lines = sql.split('\n').length;

    console.log(chalk.green(`Generated ${outputPath} (${lines} lines)`));
    console.log(chalk.dim('Remember to commit the updated schema file.'));
  } catch (error) {
    console.error(chalk.red('Failed to generate schema'));

    if (error instanceof Error) {
      // Check for common issues
      if (error.message.includes('prisma')) {
        console.error(chalk.dim('Make sure Prisma is installed: pnpm install'));
      }
      console.error(chalk.dim(error.message));
    }

    process.exitCode = 1;
  }
}
