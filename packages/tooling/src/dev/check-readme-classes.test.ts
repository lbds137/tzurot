/**
 * Tests for the pure check functions behind `guard:readme`. Each fixture is
 * a real specimen copied from the actual README, with at most ONE planted
 * mismatch per test — a fixture wrong in two classes at once would not
 * isolate which check caught it.
 */

import { describe, it, expect } from 'vitest';
import GithubSlugger from 'github-slugger';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFencedScripts,
  checkLinks,
  checkPrerequisites,
  checkProjectStructure,
  checkSlashCommands,
  classifyLines,
  extractFencedPnpmCommands,
  extractHeadingSlugs,
  extractLinkTargets,
  extractSection,
  parseProjectStructureTree,
  stripFencedBlocks,
} from './check-readme-classes.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const PROJECT_STRUCTURE = [
  '## Project Structure',
  '',
  '- **`services/`** — Microservices',
  '  - `bot-client/` — Discord bot interface (TypeScript)',
  '  - `api-gateway/` — HTTP API and request routing (TypeScript)',
  '  - `ai-worker/` — Background AI processing (TypeScript)',
  '  - `voice-engine/` — Self-hosted STT/TTS service (Python FastAPI)',
  '  - `website/` — Static site for [tzurot.org](https://tzurot.org): landing page + legal docs (Astro)',
  '- **`packages/`** — Shared code',
  '  - `common-types/` — TypeScript types, schemas, shared utilities',
  '  - `cache-invalidation/` — Redis pub/sub cache invalidation services',
  '  - `clients/` — Typed gateway API clients (generated from the route manifest)',
  '  - `config-resolver/` — LLM/TTS/vision config cascade resolvers',
  '  - `conversation-history/` — Conversation persistence + retention',
  '  - `identity/` — User/personality loading and provisioning',
  '  - `embeddings/` — Local embedding model (BGE-small-en-v1.5)',
  '  - `test-factories/` — Shared mock-data factories',
  '  - `test-utils/` — Shared test helpers and PGLite integration',
  '  - `tooling/` — Ops CLI (`pnpm ops`) and codebase analysis',
  '- **`prisma/`** — Database schema and migrations',
  '- **`scripts/`** — One-off utilities: analysis, debug, data migrations, deployment helpers',
  '- **`tzurot-legacy/`** — Archived v2 codebase (kept for migration reference)',
  '',
  '## Features',
].join('\n');

const ON_DISK_SERVICES = ['ai-worker', 'api-gateway', 'bot-client', 'voice-engine', 'website'];
const ON_DISK_PACKAGES = [
  'cache-invalidation',
  'clients',
  'common-types',
  'config-resolver',
  'conversation-history',
  'embeddings',
  'identity',
  'test-factories',
  'test-utils',
  'tooling',
];

const PREREQUISITES = [
  '### Prerequisites',
  '',
  '- Node.js 24 (the `engines` field in `package.json` is the source of truth; the dependency-cruiser gate rejects 25)',
  '- pnpm 10+',
  '- PostgreSQL 16+ with pgvector extension',
  '- Redis 7+ (for BullMQ)',
  '- Discord Bot Token',
  '- OpenRouter API Key',
  '',
  '### Setup',
].join('\n');

const FENCED_SCRIPTS = [
  '3. **Start services:**',
  '',
  '   ```bash',
  '   # Development mode (all services)',
  '   pnpm dev',
  '',
  '   # Or start individually:',
  '   pnpm --filter @tzurot/bot-client dev',
  '   ```',
  '',
  '```bash',
  'pnpm build            # Build all services',
  'pnpm test             # Run unit tests',
  'pnpm test:component   # Run component tests',
  'pnpm quality          # The full static gate',
  'pnpm format           # Format code',
  'pnpm ops --help       # CLI tooling reference',
  '```',
].join('\n');

const ROOT_SCRIPTS = {
  dev: '',
  build: '',
  test: '',
  'test:component': '',
  quality: '',
  format: '',
  ops: '',
};

const SLASH_SECTION = [
  '### Slash Commands',
  '',
  'Tzurot is fully managed via Discord slash commands.',
  '',
  '- **`/character`** — Create, edit, browse characters',
  '- **`/chat`** + **`/chime-in`** + **`/random`** — Chat one-on-one',
  '- **`/persona`** — User personas',
  '- **`/voice`** — TTS/STT provider config',
  '- **`/preset`** + **`/channel`** — Custom LLM presets',
  '- **`/models`** — Browse available AI models',
  '- **`/memory`** + **`/history`** — Long-term memory browse',
  '- **`/settings`** — Timezone, BYOK API keys',
  '- **`/notifications`** — Release-notes DM preferences',
  '- **`/feedback`** — Send feedback to the developer',
  '- **`/inspect`** + **`/help`** — Diagnostic log browser, also reachable via the **Inspect Message** and **View Reasoning** message context menus',
  '- **`/shapes`** — Legacy Shapes.inc character migration',
  '- **`/admin`** + **`/deny`** — Owner-only monitoring',
  '',
  '### 📋 Planned',
].join('\n');

const COMMAND_MODULES = [
  'admin',
  'channel',
  'character',
  'chat',
  'chime-in',
  'deny',
  'feedback',
  'help',
  'history',
  'inspect',
  'memory',
  'models',
  'notifications',
  'persona',
  'preset',
  'random',
  'settings',
  'shapes',
  'voice',
];

const CONTEXT_MENU_NAMES = ['Inspect Message', 'View Reasoning'];

const LINKS_README = [
  '# Tzurot v3',
  '',
  '[![codecov](https://codecov.io/gh/lbds137/tzurot/branch/develop/graph/badge.svg)](https://codecov.io/gh/lbds137/tzurot)',
  '',
  '## Quick Start',
  '',
  '## Development',
  '',
  'see [Quick Start](#quick-start) and [Development](#development) above.',
  'see [BACKLOG.md](BACKLOG.md) and [docs](docs/steam-deck/).',
].join('\n');

const FENCE_HEADING_FIXTURE = [
  '## Section',
  '',
  '```bash',
  '# not a heading',
  '```',
  '',
  '## Next',
].join('\n');

describe('extractSection', () => {
  it('returns the body between a heading line and the next heading', () => {
    expect(extractSection(PREREQUISITES, '### Prerequisites')).toContain('Node.js 24');
    expect(extractSection(PREREQUISITES, '### Prerequisites')).not.toContain('Setup');
  });

  it('returns the fence verbatim, including a `#` line inside it, and stops at the real next heading', () => {
    const body = extractSection(FENCE_HEADING_FIXTURE, '## Section');
    expect(body).toContain('```bash');
    expect(body).toContain('# not a heading');
    expect(body).not.toContain('## Next');
  });
});

describe('checkProjectStructure', () => {
  it('is clean against the real Project Structure section and on-disk directories', () => {
    expect(checkProjectStructure(PROJECT_STRUCTURE, ON_DISK_SERVICES, ON_DISK_PACKAGES)).toEqual(
      []
    );
  });

  it('flags a directory on disk that is missing from the README tree', () => {
    const findings = checkProjectStructure(
      PROJECT_STRUCTURE,
      [...ON_DISK_SERVICES, 'new-service'],
      ON_DISK_PACKAGES
    );
    expect(findings).toEqual([
      "services/new-service/ exists on disk but is not listed under services/ in the README's Project Structure",
    ]);
  });

  it('flags a README entry with no matching on-disk directory', () => {
    const withoutBotClient = ON_DISK_SERVICES.filter(name => name !== 'bot-client');
    const findings = checkProjectStructure(PROJECT_STRUCTURE, withoutBotClient, ON_DISK_PACKAGES);
    expect(findings).toEqual([
      "README's Project Structure lists services/bot-client/ but that directory does not exist",
    ]);
  });
});

describe('checkPrerequisites', () => {
  it('is clean against the real Prerequisites section and matching engines', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '>=24.0.0', pnpm: '>=10.0.0' })).toEqual([]);
  });

  it('resolves the major version from a full `>=X.Y.Z` engines range, not just a bare major', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '>=24.5.2', pnpm: '>=10.9.1' })).toEqual([]);
  });

  it('reads only the first integer of a compound range (documented limitation)', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '^24 || >=25', pnpm: '>=10.0.0' })).toEqual(
      []
    );
  });

  it('flags a Node.js major mismatch', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '>=25.0.0', pnpm: '>=10.0.0' })).toEqual([
      'Prerequisites says "Node.js 24" but package.json engines.node requires 25',
    ]);
  });

  it('flags a pnpm major mismatch', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '>=24.0.0', pnpm: '>=10.5.0' })).toEqual([]);
    expect(checkPrerequisites(PREREQUISITES, { node: '>=24.0.0', pnpm: '>=11.0.0' })).toEqual([
      'Prerequisites says "pnpm 10+" but package.json engines.pnpm requires 11',
    ]);
  });

  it('flags a missing "Node.js <version>" line in Prerequisites', () => {
    const withoutNode = PREREQUISITES.replace(/- Node\.js.*\n/, '');
    expect(checkPrerequisites(withoutNode, { node: '>=24.0.0', pnpm: '>=10.0.0' })).toEqual([
      'Prerequisites has no "Node.js <version>" line',
    ]);
  });

  it('flags a missing "pnpm <version>+" line in Prerequisites', () => {
    const withoutPnpm = PREREQUISITES.replace(/- pnpm.*\n/, '');
    expect(checkPrerequisites(withoutPnpm, { node: '>=24.0.0', pnpm: '>=10.0.0' })).toEqual([
      'Prerequisites has no "pnpm <version>+" line',
    ]);
  });

  it('flags a missing engines.node range', () => {
    expect(checkPrerequisites(PREREQUISITES, { pnpm: '>=10.0.0' })).toEqual([
      'package.json engines has no "node" range to compare against',
    ]);
  });

  it('flags a missing engines.pnpm range', () => {
    expect(checkPrerequisites(PREREQUISITES, { node: '>=24.0.0' })).toEqual([
      'package.json engines has no "pnpm" range to compare against',
    ]);
  });
});

describe('checkFencedScripts', () => {
  it('is clean against the real fenced pnpm blocks and root scripts', () => {
    expect(checkFencedScripts(FENCED_SCRIPTS, ROOT_SCRIPTS)).toEqual([]);
  });

  it('flags a fenced pnpm script with no matching root script', () => {
    const missingBuild: Record<string, string> = { ...ROOT_SCRIPTS };
    delete missingBuild.build;
    expect(checkFencedScripts(FENCED_SCRIPTS, missingBuild)).toEqual([
      'fenced `pnpm build` has no matching "build" key in package.json scripts',
    ]);
  });

  it('skips pnpm builtins and --filter invocations', () => {
    const fence = ['```bash', 'pnpm install', 'pnpm --filter @tzurot/bot-client dev', '```'].join(
      '\n'
    );
    expect(checkFencedScripts(fence, {})).toEqual([]);
  });

  it('skips `pnpm why` and `pnpm outdated` as builtins', () => {
    const fence = ['```bash', 'pnpm why foo', 'pnpm outdated', '```'].join('\n');
    expect(checkFencedScripts(fence, {})).toEqual([]);
  });

  it('flags a non-builtin, non-script pnpm subcommand typo', () => {
    const fence = ['```bash', 'pnpm buidl', '```'].join('\n');
    expect(checkFencedScripts(fence, {})).toEqual([
      'fenced `pnpm buidl` has no matching "buidl" key in package.json scripts',
    ]);
  });
});

describe('extractFencedPnpmCommands', () => {
  it('ignores a `pnpm` line inside a non-shell-tagged fence', () => {
    const fence = ['```json', 'pnpm bogus', '```'].join('\n');
    expect(extractFencedPnpmCommands(fence)).toEqual([]);
  });

  it('scans a `pnpm` line inside a ```bash fence', () => {
    const fence = ['```bash', 'pnpm bogus', '```'].join('\n');
    expect(extractFencedPnpmCommands(fence)).toEqual(['bogus']);
  });

  it('ignores a `pnpm` line inside a bare (untagged) fence', () => {
    const fence = ['```', 'pnpm bogus', '```'].join('\n');
    expect(extractFencedPnpmCommands(fence)).toEqual([]);
  });

  it('strips only a trailing whitespace-preceded comment, not a `#` inside a token', () => {
    const trailingComment = ['```bash', 'pnpm build # comment', '```'].join('\n');
    expect(extractFencedPnpmCommands(trailingComment)).toEqual(['build']);

    const hashInFlag = ['```bash', 'pnpm ops xray --format md#x', '```'].join('\n');
    expect(extractFencedPnpmCommands(hashInFlag)).toEqual(['ops']);

    const hashInToken = ['```bash', 'pnpm test#tag', '```'].join('\n');
    expect(extractFencedPnpmCommands(hashInToken)).toEqual(['test#tag']);
    expect(checkFencedScripts(hashInToken, ROOT_SCRIPTS)).toEqual([
      'fenced `pnpm test#tag` has no matching "test#tag" key in package.json scripts',
    ]);
  });

  it('documented limitation: a chained fenced line reads only its first pnpm invocation', () => {
    const fence = ['```bash', 'pnpm lint && pnpm test', '```'].join('\n');
    expect(extractFencedPnpmCommands(fence)).toEqual(['lint']);
  });
});

describe('checkSlashCommands', () => {
  it('is clean against the real Slash Commands section and shipped commands', () => {
    expect(checkSlashCommands(SLASH_SECTION, COMMAND_MODULES, CONTEXT_MENU_NAMES)).toEqual([]);
  });

  it('flags a shipped slash command missing from the section', () => {
    const findings = checkSlashCommands(
      SLASH_SECTION,
      [...COMMAND_MODULES, 'newcmd'],
      CONTEXT_MENU_NAMES
    );
    expect(findings).toEqual([
      "/newcmd is a shipped slash command but no `/newcmd` appears in the README's Slash Commands section",
    ]);
  });

  it('flags a shipped context-menu command missing from the section', () => {
    const findings = checkSlashCommands(SLASH_SECTION, COMMAND_MODULES, [
      ...CONTEXT_MENU_NAMES,
      'New Menu',
    ]);
    expect(findings).toEqual([
      '"New Menu" is a shipped message context-menu command but does not appear in the README\'s Slash Commands section',
    ]);
  });
});

describe('extractHeadingSlugs', () => {
  it("slugs the README's own #quick-start and #development anchors", () => {
    expect(extractHeadingSlugs(LINKS_README)).toContain('quick-start');
    expect(extractHeadingSlugs(LINKS_README)).toContain('development');
  });

  it('slugs a heading with emoji/punctuation the same way github-slugger does', () => {
    const heading = '### 📋 Planned';
    const readme = [heading].join('\n');
    const expectedSlug = new GithubSlugger().slug('📋 Planned');
    expect(extractHeadingSlugs(readme)).toEqual(new Set([expectedSlug]));
  });

  it('gives duplicate headings the real GitHub -1, -2 suffixes', () => {
    const readme = ['## Foo', '## Foo'].join('\n');
    expect(extractHeadingSlugs(readme)).toEqual(new Set(['foo', 'foo-1']));
  });

  it('does not slug a `#` comment inside a fenced code block', () => {
    const slugs = extractHeadingSlugs(FENCE_HEADING_FIXTURE);
    expect(slugs.has('not-a-heading')).toBe(false);
    expect(slugs.has('section')).toBe(true);
    expect(slugs.has('next')).toBe(true);
  });

  it('does not contain slugs for the real README shell-fence `#` comments', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf-8');
    const slugs = extractHeadingSlugs(readme);
    expect(slugs.has('logs')).toBe(false);
    expect(slugs.has('status')).toBe(false);
  });
});

describe('checkLinks', () => {
  const pathExists = (relPath: string): boolean =>
    relPath === 'BACKLOG.md' || relPath === 'docs/steam-deck/';

  it('is clean against real link targets that all resolve', () => {
    expect(checkLinks(LINKS_README, pathExists)).toEqual([]);
  });

  it('flags a relative link target that does not resolve', () => {
    const withBadLink = LINKS_README + '\nsee [Missing](docs/does-not-exist.md).';
    expect(checkLinks(withBadLink, pathExists)).toEqual([
      'README link target "docs/does-not-exist.md" does not resolve to a file or directory',
    ]);
  });

  it('flags a bare anchor with no matching heading', () => {
    const withBadAnchor = LINKS_README + '\nsee [Nope](#nonexistent-heading).';
    expect(checkLinks(withBadAnchor, pathExists)).toEqual([
      'README link target "#nonexistent-heading" has no matching heading anchor',
    ]);
  });

  it('never flags external http(s)/mailto links', () => {
    const external = '[a](https://example.com) [b](mailto:x@example.com)';
    expect(checkLinks(external, () => false)).toEqual([]);
  });

  it('flags a link to a `#` comment inside a fence as a non-heading anchor', () => {
    const fixture = FENCE_HEADING_FIXTURE + '\nsee [x](#not-a-heading).';
    const findings = checkLinks(fixture, () => false);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(finding => finding.includes('#not-a-heading'))).toBe(true);
  });

  it('does not flag a `](...)`-shaped fragment inside a bash fence as a link', () => {
    const fenced = ['```bash', 'echo "foo](bar)"', '```'].join('\n');
    expect(checkLinks(fenced, () => false)).toEqual([]);
  });

  it('flags the same `](...)`-shaped fragment when it is outside any fence', () => {
    const unfenced = 'echo "foo](bar)"';
    const findings = checkLinks(unfenced, () => false);
    expect(findings.some(finding => finding.includes('bar'))).toBe(true);
  });
});

describe('extractLinkTargets', () => {
  it('excludes a link target whose `](...)` sits inside a bash fence', () => {
    const fenced = ['```bash', 'echo "foo](bar)"', '```'].join('\n');
    expect(extractLinkTargets(fenced)).not.toContain('bar');
  });

  it('includes a link target whose `](...)` sits outside any fence', () => {
    const unfenced = 'echo "foo](bar)"';
    expect(extractLinkTargets(unfenced)).toContain('bar');
  });
});

// ---------------------------------------------------------------------------
// classifyLines: the shared fence classifier behind both stripFencedBlocks
// and extractFencedPnpmCommands
// ---------------------------------------------------------------------------

const TILDE_FENCE = ['before', '~~~sh', 'pnpm tildescript', '~~~', 'after'].join('\n');

const MIXED_FENCE = [
  'before',
  '```bash',
  'pnpm should-not-see-me',
  '~~~ still interior, not a closer',
  'pnpm still-inside',
  '```',
  'after',
].join('\n');

describe('classifyLines', () => {
  it('gives one entry per input line, in order', () => {
    const readme = ['a', 'b', 'c'].join('\n');
    expect(classifyLines(readme).map(c => c.line)).toEqual(['a', 'b', 'c']);
  });

  it('marks a fence delimiter as delimiter:true, fenced:false, with the lowercased info-string as tag', () => {
    const classified = classifyLines(TILDE_FENCE);
    expect(classified[1]).toEqual({ line: '~~~sh', fenced: false, delimiter: true, tag: 'sh' });
    expect(classified[3]).toEqual({ line: '~~~', fenced: false, delimiter: true, tag: 'sh' });
  });

  it('marks the fence interior as fenced:true, carrying the opening tag', () => {
    const classified = classifyLines(TILDE_FENCE);
    expect(classified[2]).toEqual({
      line: 'pnpm tildescript',
      fenced: true,
      delimiter: false,
      tag: 'sh',
    });
  });

  it('marks lines outside any fence as fenced:false, delimiter:false, tag:null', () => {
    const classified = classifyLines(TILDE_FENCE);
    expect(classified[0]).toEqual({ line: 'before', fenced: false, delimiter: false, tag: null });
    expect(classified[4]).toEqual({ line: 'after', fenced: false, delimiter: false, tag: null });
  });

  it('does not close a ``` fence on a ~~~ line, or vice versa (same-character closing only)', () => {
    const classified = classifyLines(MIXED_FENCE);
    // The `~~~ still interior...` line stays fenced — it is NOT treated as a delimiter.
    const tildeLine = classified[3];
    expect(tildeLine.line).toBe('~~~ still interior, not a closer');
    expect(tildeLine).toEqual({
      line: '~~~ still interior, not a closer',
      fenced: true,
      delimiter: false,
      tag: 'bash',
    });
  });

  it('records no tag for an untagged fence (empty info-string)', () => {
    const readme = ['```', 'interior', '```'].join('\n');
    const classified = classifyLines(readme);
    expect(classified[0]).toEqual({ line: '```', fenced: false, delimiter: true, tag: '' });
    expect(classified[1]).toEqual({ line: 'interior', fenced: true, delimiter: false, tag: '' });
  });

  it('leaves an unterminated fence classified as fenced through EOF', () => {
    const readme = ['```bash', 'pnpm never-closed'].join('\n');
    const classified = classifyLines(readme);
    expect(classified[1]).toEqual({
      line: 'pnpm never-closed',
      fenced: true,
      delimiter: false,
      tag: 'bash',
    });
  });
});

describe('shared classifier: ~~~ fences are understood by both consumers', () => {
  it('stripFencedBlocks blanks a ~~~ fence interior and keeps the delimiters + line count', () => {
    const stripped = stripFencedBlocks(TILDE_FENCE);
    expect(stripped).toEqual(['before', '~~~sh', '', '~~~', 'after']);
    expect(stripped).toHaveLength(TILDE_FENCE.split('\n').length);
  });

  it('extractFencedPnpmCommands picks up a pnpm line inside a ~~~sh fence', () => {
    expect(extractFencedPnpmCommands(TILDE_FENCE)).toEqual(['tildescript']);
  });

  it('extractFencedPnpmCommands still skips a ``` fence containing a ~~~ interior line (same-character closing)', () => {
    // Both pnpm invocations are inside the ``` fence — the ~~~ line never closes it.
    expect(extractFencedPnpmCommands(MIXED_FENCE)).toEqual(['should-not-see-me', 'still-inside']);
  });

  it('stripFencedBlocks blanks straight through a ~~~ interior line inside a ``` fence', () => {
    const stripped = stripFencedBlocks(MIXED_FENCE);
    expect(stripped).toEqual(['before', '```bash', '', '', '', '```', 'after']);
  });
});

describe('parseProjectStructureTree: nested-path sub-bullet', () => {
  it('does not mis-capture a nested-path sub-bullet like `foo/bar/` as `foo/bar`', () => {
    const nestedFixture = [
      '## Project Structure',
      '',
      '- **`packages/`** — Shared code',
      '  - `foo/bar/` — a nested path, not a package name',
      '',
      '## Features',
    ].join('\n');
    const tree = parseProjectStructureTree(nestedFixture);
    expect(tree.packages).not.toContain('foo/bar');
    expect(tree.packages).toEqual([]);
  });

  it('surfaces the on-disk-but-not-listed finding rather than a bogus name, end to end', () => {
    const nestedFixture = [
      '## Project Structure',
      '',
      '- **`packages/`** — Shared code',
      '  - `foo/bar/` — a nested path, not a package name',
      '',
      '## Features',
    ].join('\n');
    const findings = checkProjectStructure(nestedFixture, [], ['real-package']);
    expect(findings).toEqual([
      "packages/real-package/ exists on disk but is not listed under packages/ in the README's Project Structure",
    ]);
  });
});
