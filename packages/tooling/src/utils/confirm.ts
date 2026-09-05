/**
 * Shared yes/no confirmation prompt for operator-facing ops commands that
 * make a change and want a chance to back out first.
 */

import { createInterface } from 'node:readline';
import chalk from 'chalk';

/**
 * Print `warning`, then ask "Continue? (yes/no): " on stdin/stdout.
 * Resolves `true` only for an exact (case-insensitive) "yes" — deliberately
 * not widened to accept "y".
 */
export async function confirmPrompt(warning: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    console.log(chalk.yellow(warning));
    rl.question('Continue? (yes/no): ', answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}
