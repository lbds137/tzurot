/**
 * ESLint Rule: no-discord-builders-in-commands
 *
 * The UX-boundary guard (design-system machinery §4.5/G10): command files must
 * not hand-build Discord message UI — embeds, action rows, buttons, selects,
 * modals, Components-V2 primitives — they compose the shared ux/ builders
 * (listEmbedBuilder, buildEntityDetailCard, ModalFactory/toolkit, confirmation
 * factories) instead. Hand-built UI in a command file is exactly how the
 * pre-design-system drift accumulated (17 hand-built browse embeds, 11
 * hand-rolled modals, 4 confirmation implementations).
 *
 * What is flagged: a VALUE import of a restricted `*Builder` symbol from
 * 'discord.js' in a file under `services/bot-client/src/commands/`, unless the
 * (file, symbol) pair is grandfathered in `builder-import-allowlist.ts`
 * (shrink-only — see its header contract).
 *
 * What is NOT flagged:
 *   - Type-only imports (`import type { EmbedBuilder }` / `{ type EmbedBuilder }`)
 *     — types can't construct UI; command files legitimately type parameters
 *     with builder types.
 *   - `SlashCommandBuilder` / `ContextMenuCommandBuilder` — command DEFINITIONS
 *     belong in command files; the boundary covers message UI only.
 *   - Files outside `commands/` — the shared builders themselves live in
 *     utils/ and ux/ and obviously construct builders.
 *
 * A module-level depcruise boundary ("commands must not import discord.js")
 * is deliberately NOT the mechanism: 147 command files import interaction
 * TYPES legitimately, and depcruise cannot see symbol granularity. The
 * import-symbol rule is the feasible 80/20; the types-from-common-types
 * refactor that would enable a module boundary is a trigger-gated backlog
 * idea (`backlog/cold/ideas.md`).
 */

import type { Rule } from 'eslint';
import { BUILDER_IMPORT_ALLOWLIST } from './builder-import-allowlist.js';

/** Message-UI builder symbols the boundary restricts. */
const RESTRICTED_BUILDER =
  /^(?:Embed|ActionRow|Button|StringSelectMenu|UserSelectMenu|RoleSelectMenu|ChannelSelectMenu|MentionableSelectMenu|Modal|TextInput|Container|Section|TextDisplay|MediaGallery|Separator|Thumbnail|FileUpload|Label)Builder$/;

const COMMANDS_MARKER = 'services/bot-client/src/commands/';

/**
 * The repo-relative path of the linted file (forward slashes), or null when
 * the file is not under the commands tree. Suffix-matching from the marker
 * keeps the rule cwd-independent (lint-staged invokes eslint from varying
 * working directories).
 */
function commandsRelativePath(filename: string): string | null {
  const normalized = filename.replace(/\\/g, '/');
  const at = normalized.indexOf(COMMANDS_MARKER);
  return at === -1 ? null : normalized.slice(at);
}

interface ImportSpecifierNode {
  type: string;
  importKind?: string;
  imported?: { type: string; name?: string };
  local?: { name?: string };
}

interface ImportDeclarationNode {
  source: { value?: unknown };
  importKind?: string;
  specifiers: ImportSpecifierNode[];
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow value-importing discord.js message-UI builders in command files — compose the shared ux/ builders instead',
      recommended: true,
    },
    messages: {
      restrictedBuilder:
        "'{{symbol}}' is a Discord message-UI builder; command files compose the shared builders (listEmbedBuilder, buildEntityDetailCard, ModalFactory/toolkit, confirmation factories) instead of hand-building UI. If the shared builders genuinely cannot express this surface, extend them — do not add to the shrink-only allowlist without that conversation.",
    },
    schema: [],
  },

  create(context) {
    const relPath = commandsRelativePath(context.filename);
    if (relPath === null || relPath.endsWith('.test.ts')) {
      return {};
    }
    const allowed = new Set(BUILDER_IMPORT_ALLOWLIST[relPath] ?? []);

    return {
      ImportDeclaration(node) {
        const decl = node as unknown as ImportDeclarationNode;
        if (decl.source.value !== 'discord.js' || decl.importKind === 'type') {
          return;
        }
        for (const spec of decl.specifiers) {
          if (spec.type !== 'ImportSpecifier' || spec.importKind === 'type') {
            continue;
          }
          const name = spec.imported?.name;
          if (name !== undefined && RESTRICTED_BUILDER.test(name) && !allowed.has(name)) {
            context.report({
              node: spec as unknown as Rule.Node,
              messageId: 'restrictedBuilder',
              data: { symbol: name },
            });
          }
        }
      },
    };
  },
};

export default rule;
