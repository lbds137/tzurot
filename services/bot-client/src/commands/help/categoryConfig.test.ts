/**
 * Completeness gate for CATEGORY_CONFIG (design-system §5.3a).
 *
 * CommandHandler derives each command's help category from its top-level
 * folder name (capitalized — see deriveCategory). A folder without a
 * CATEGORY_CONFIG entry silently falls into "📦 Other", which is exactly the
 * kind of drift a rename or a new command folder introduces. This test makes
 * the config↔folders sync mechanical in BOTH directions: every folder has an
 * entry, and every entry (except the "Other" fallback and this Help folder's
 * own) corresponds to a real folder.
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CATEGORY_CONFIG } from './index.js';

const commandsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Mirrors CommandHandler's deriveCategory transform (first char upper). */
function folderToCategory(folder: string): string {
  return folder.charAt(0).toUpperCase() + folder.slice(1);
}

function commandFolders(): string[] {
  return readdirSync(commandsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

describe('CATEGORY_CONFIG completeness', () => {
  it('has an entry for every command folder — nothing falls into "Other"', () => {
    const missing = commandFolders()
      .map(folderToCategory)
      .filter(category => CATEGORY_CONFIG[category] === undefined);
    expect(missing).toEqual([]);
  });

  it('has no stale entries — every category (except the Other fallback) is a real folder', () => {
    const folders = new Set(commandFolders().map(folderToCategory));
    const stale = Object.keys(CATEGORY_CONFIG).filter(
      category => category !== 'Other' && !folders.has(category)
    );
    expect(stale).toEqual([]);
  });

  it('assigns a unique display order to every category', () => {
    const orders = Object.values(CATEGORY_CONFIG).map(config => config.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
