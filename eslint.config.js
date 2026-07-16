import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sonarjs from 'eslint-plugin-sonarjs';
import * as regexpPlugin from 'eslint-plugin-regexp';
import importPlugin from 'eslint-plugin-import-x';
import tzurotPlugin from './packages/tooling/dist/eslint/index.js';
import vitest from '@vitest/eslint-plugin';
import astroPlugin from 'eslint-plugin-astro';

// Get the directory name of the current module (monorepo root)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared Pino logger rules — applied in the main TS block AND re-applied in
// the UserService/persona-crud override block (which otherwise resets the
// full `no-restricted-syntax` array and would drop these rules for those
// files). Extracted to avoid silent drift if the selectors change.
//
// Two rule shapes per level:
//
//   1. Single-arg Identifier/MemberExpression/CallExpression → fires.
//      Catches `logger.warn(error)` and `logger.warn(buildError())` where
//      the error variable is being used as both first-arg fields and msg,
//      losing any explicit message context. Doesn't fire on two-arg form
//      `logger.info(prebuiltFields, 'msg')` — that's legitimate Pino usage
//      where the Identifier is a prebuilt fields object. The arity guard
//      eliminates the false-positive that otherwise forces `{ ...opts }`
//      spread workarounds.
//
//   2. Any-arity TemplateLiteral first-arg → fires.
//      Catches `logger.warn(`msg ${var}`)` regardless of arity. Template
//      literals always lose structure per 02-code-standards.md — the
//      variable should move into the fields object.
//
// Bare string Literals pass through at any arity (valid `logger.warn('msg')`).
const PINO_LEVELS = Object.freeze(['error', 'warn', 'info', 'debug']);
const PINO_LOGGER_RULES = PINO_LEVELS.flatMap(level => [
  {
    selector: `CallExpression[callee.property.name="${level}"][arguments.length=1] > *.arguments:first-child:matches(Identifier, MemberExpression, CallExpression)`,
    message: `logger.${level}() with a single non-string argument loses message context. Use logger.${level}({ err: error }, "message") or logger.${level}({ fields }, "message"). See packages/common-types/src/logger.ts.`,
  },
  {
    selector: `CallExpression[callee.property.name="${level}"] > *.arguments:first-child:matches(TemplateLiteral)`,
    message: `logger.${level}() template-literal messages lose structure — move interpolated variables into the fields object: logger.${level}({ fields }, "static message"). See packages/common-types/src/logger.ts.`,
  },
]);

// Identity & Provisioning Hardening (epic Phase 2): all User creation must
// route through UserService. Shared across the main block and the route-level
// override so it stays enforced even when the routes override replaces the
// `no-restricted-syntax` rule wholesale.
// Block `await channel.sendTyping()` — the specific pattern that exposes the
// hang. discord.js's sendTyping has been observed to hang indefinitely under
// sustained Discord rate-limit pressure (the promise neither resolves nor
// rejects), so awaiting it blocks the surrounding pipeline indefinitely.
// Direct `.then()/.catch()` chains on `channel.sendTyping()` aren't blocked
// here — they're fire-and-forget by construction and don't expose the bug —
// but contributors should still prefer the `sendTypingIndicator` helper at
// services/bot-client/src/utils/typingErrorClassifier.ts for latency
// telemetry + classified error handling.
const SEND_TYPING_RULES = [
  {
    selector: "AwaitExpression > CallExpression[callee.property.name='sendTyping']",
    message:
      'Never `await channel.sendTyping()` — discord.js sendTyping can hang indefinitely under rate-limit pressure (queue stall with no resolver). Use `sendTypingIndicator(channel, { logger, source, typingInterval? })` from utils/typingErrorClassifier instead. See its docstring for rationale.',
  },
];

// Per `.claude/rules/04-discord.md` "Component Interaction Routing": commands
// with interactive components MUST route via CommandHandler → handleButton /
// handleModal / handleSelectMenu. Inline collectors (awaitMessageComponent /
// awaitModalSubmit / createMessageComponentCollector) race with CommandHandler
// — the loser produces "Unknown interaction" 10062 errors at random under load.
//
// Exception: collectors may be used INSIDE exported handler functions as a
// secondary mechanism (e.g., a timeout-bounded confirmation wait). Suppress with:
//   // eslint-disable-next-line no-restricted-syntax -- secondary collector inside exported handler; see 04-discord.md
const COMPONENT_ROUTING_RULES = [
  {
    selector: "CallExpression[callee.property.name='awaitMessageComponent']",
    message:
      "Don't use `.awaitMessageComponent()` as a primary interaction handler — it races with CommandHandler. Route component interactions via `handleButton` / `handleSelectMenu` exports + the `command::action::id` customId format. See `.claude/rules/04-discord.md` 'Component Interaction Routing'.",
  },
  {
    selector: "CallExpression[callee.property.name='awaitModalSubmit']",
    message:
      "Don't use `.awaitModalSubmit()` as a primary interaction handler — it races with CommandHandler. Route modal submits via the `handleModal` export + customId routing. See `.claude/rules/04-discord.md` 'Component Interaction Routing'.",
  },
  {
    selector: "CallExpression[callee.property.name='createMessageComponentCollector']",
    message:
      "Don't use `.createMessageComponentCollector()` as a primary interaction handler — it races with CommandHandler. Route via `handleButton` / `handleSelectMenu` exports. See `.claude/rules/04-discord.md` 'Component Interaction Routing'.",
  },
];

// Forward-safety: in the envelope-building path (contextBuilder/ +
// MessageContextBuilder), the trigger `message`'s content-bearing fields are
// EMPTY for a native Discord forward — the real content lives in
// `message.messageSnapshots`, not the top-level fields. Reading
// `message.content`/`.attachments`/`.embeds`/`.mentions` directly there is the
// footgun behind the forwarded-text content-loss bug (the worker re-derived the
// turn from an empty `rawMessageContent`). Route through the forward-aware
// helpers in utils/forwardedMessageUtils.ts instead: getEffectiveContent (text),
// extractForwardedAttachments / buildMessageContent (attachments+images),
// hasVoiceAttachments (voice). The selector targets the Discord `message`
// identifier specifically, so `msg.content` (a ConversationMessage) and
// `snapshot.content` are unaffected. A legitimate non-forward read can suppress
// with an eslint-disable + a concrete justification.
const FORWARD_SAFE_MESSAGE_READ_RULES = [
  {
    selector:
      "MemberExpression[object.name='message'][property.name=/^(content|attachments|embeds|mentions)$/]",
    message:
      "Don't read message.content/.attachments/.embeds/.mentions directly in the envelope-building path — they are EMPTY for forwarded triggers (content rides message.messageSnapshots). Use the forward-aware helpers in utils/forwardedMessageUtils.ts (getEffectiveContent, extractForwardedAttachments, hasVoiceAttachments) or buildMessageContent. Suppress with a justification only for a verified non-forward read.",
  },
];

const IDENTITY_PROVISIONING_RULES = [
  {
    selector:
      "CallExpression[callee.property.name=/^(create|upsert|createMany)$/][callee.object.property.name='user']",
    message:
      'Direct prisma.user.create/upsert/createMany is banned outside UserService. Use userService.getOrCreateUser, which goes through the full provisioning path. HTTP routes receive the provisioned user via the requireProvisionedUser middleware (req.provisionedUserId). See epic-identity-hardening.md.',
  },
  {
    selector:
      "CallExpression[callee.property.name=/^(create|upsert|createMany)$/][callee.object.property.name='persona']",
    message:
      'Direct prisma.persona.create/upsert/createMany is banned outside UserService and persona/crud.ts. Persona lifecycle must go through the centralized service to preserve the userId+personaId deterministic-UUID invariant.',
  },
  {
    selector: "CallExpression[callee.name='generateLlmConfigUuid']",
    message:
      'generateLlmConfigUuid is deprecated for prod callers — it caused phantom PK collisions when users cloned+renamed LlmConfigs (bug 2026-04-19). Use `newLlmConfigId()` for new rows and rely on the `@@unique([ownerId, name])` DB constraint for name uniqueness. See the @deprecated docstring in packages/common-types/src/utils/deterministicUuid.ts. Test fixtures are allowed; if your file is test-adjacent, add eslint-disable with a concrete justification.',
  },
];

// Identity Epic Phase 6: handlers mounted behind `requireProvisionedUser` must
// read the internal UUID from `req.provisionedUserId` (or via the
// `resolveProvisionedUserId` helper), NOT re-derive it by querying the users
// table by the Discord snowflake. The middleware has already done that lookup.
// Querying `user.find*({ where: { discordId } })` in a route handler is either
// (a) a redundant DB round-trip, or (b) a sign the handler is working with the
// wrong identity — the exact class of drift that shipped as the 2026-04-23
// auth.ts regression (PR #880) and the 2026-04-22 createStoreHandler-vs-
// siblings inconsistency that surfaced on PR #879.
//
// Scope: only routes under `services/api-gateway/src/routes/**/*.ts`. Other
// locations (UserService, AuthMiddleware) legitimately look users up by
// Discord ID and are excluded by the `files:` glob on the override below.
const PROVISIONED_USER_ROUTE_RULES = [
  {
    // Only fire when `discordId` appears inside a `where` clause of a
    // prisma.user.* query — that's the identity-lookup pattern. A column
    // selection like `select: { discordId: true }` on an already-joined user
    // row is not an identity lookup and must not trip the rule.
    selector:
      "CallExpression[callee.property.name=/^(findFirst|findUnique|findMany|count|delete|deleteMany|update|updateMany)$/][callee.object.property.name='user'] Property[key.name='where'] ObjectExpression Property[key.name='discordId']",
    message:
      'Route handlers under `requireProvisionedUser` must not query the users table by discordId — the middleware has already attached the internal UUID to `req.provisionedUserId`. Use `resolveProvisionedUserId(req, userService)` instead. See epic-identity-hardening.md Phase 5c/6 and BACKLOG.md (Phase 5c work items). If you have a legitimate cross-user lookup (e.g., admin routes under requireOwnerAuth), add an eslint-disable with a concrete justification.',
  },
  {
    // Ban direct `new UserService(prisma)` in route files. PR #883 harmonized
    // instantiation through `getOrCreateUserService` (AuthMiddleware.ts), which
    // keys by PrismaClient so all routes sharing a client share one UserService
    // instance — direct instantiation in a route factory defeats that cache.
    // AuthMiddleware.ts itself lives outside routes/**, so it's automatically
    // exempt from this scope.
    selector: "NewExpression[callee.name='UserService']",
    message:
      'Route files must not instantiate UserService directly. Use `getOrCreateUserService(prisma)` from `../services/AuthMiddleware.js` — it keys by PrismaClient so all routes share one instance and its caches. Direct construction creates orphan UserService instances that duplicate TTLCache state (user/persona lookups) and bypass registry-wide invalidation. If you have a legitimate reason (e.g., a test fixture that survives the ESLint test-file ignore), add an eslint-disable with a concrete justification.',
  },
];

export default tseslint.config(
  // Base configurations
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      // Test files are NO LONGER globally ignored — they get a dedicated,
      // type-checking-disabled config block below (vitest correctness rules +
      // a fake-timer ban). The main `**/*.ts` block excludes them so its
      // type-aware/size rules don't apply.
      'coverage/**',
      '.pnpm-store/**',
      '**/vitest.config.ts',
      'vitest.component.config.ts',
      'vitest.integration.config.ts',
      'vitest.eval.config.ts',
      'vitest.workspace.ts',
      'prisma.config.ts',
      'audit.config.ts',
      // Audit-canary fixtures: deliberately-bad files that the audit tools
      // must detect. Production lint skips them; the canary tests invoke
      // each audit tool with `--no-ignore` so the canaries are scanned.
      '**/test-fixtures/**',
      'tzurot-legacy/**',
      'scripts/**',
      '**/scripts/**',
      'prisma/**',
      // Un-ignore generated Prisma files so ESLint can parse them for type resolution
      // (negation brings them back into scope for the parser)
      '!packages/common-types/src/generated/**',
      // Route-manifest generated client classes — auto-generated by
      // `pnpm ops codegen:routes`. The in-file `/* eslint-disable */`
      // header gets parsed in non-standard ways by `xray --suppressions`
      // (no rule name + `--` justification reads ambiguously), so we
      // ignore at the config level instead.
      '**/_generated/**',
    ],
  },

  // Disable linting rules for generated Prisma files (but allow parsing for type info)
  {
    files: ['packages/common-types/src/generated/**/*.ts'],
    rules: {
      // Disable all rules for auto-generated code
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },

  // Mock factory files - allow this aliasing for instance tracking pattern
  {
    files: ['**/test/mocks/**/*.ts'],
    rules: {
      // Mock factories intentionally alias 'this' to track instances for test assertions
      // Pattern: mockInstance = this; (in constructor)
      '@typescript-eslint/no-this-alias': 'off',
    },
  },

  // Configuration for TypeScript files (production + tooling source).
  // Test files are excluded here and handled by the dedicated test block below
  // (type-checking disabled, size/complexity off, vitest correctness rules on).
  {
    files: ['**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    plugins: {
      '@tzurot': tzurotPlugin,
      sonarjs,
      regexp: regexpPlugin,
      import: importPlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true, // Automatically discover all TypeScript projects (v8+)
        tsconfigRootDir: __dirname, // Use the resolved root directory
      },
    },
    rules: {
      // Merge multiple imports from the same module into one statement. The core
      // `no-duplicate-imports` rule can't merge a type-only and a value import
      // from the same module; `prefer-inline` makes this one do so with inline
      // `type` markers (without it, the autofix folds the value import into an
      // `import type {}` block and emits invalid code).
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      // TypeScript specific rules
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/consistent-generic-constructors': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',

      // General code quality rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],

      // Async/Promise rules
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-return-await': 'error',

      // Pino logger error handling + identity-provisioning choke point rules.
      //
      // The identity-provisioning selectors below match the syntactic pattern
      // `X.user.create(...)` / `X.persona.create(...)`. They do NOT catch
      // bypasses via aliasing:
      //     const u = prisma.user; u.create(...)          // NOT flagged
      //     const { user } = prisma; user.create(...)     // NOT flagged
      // Type-flow analysis would be needed for exhaustive coverage. In
      // practice nobody destructures `prisma.user` in this codebase, so the
      // syntactic rule is a strong first line of defense. If that changes,
      // either stop the destructure in review or extend this with a
      // dependency-cruiser rule that catches the import-level pattern.
      'no-restricted-syntax': [
        'error',
        ...PINO_LOGGER_RULES,
        ...IDENTITY_PROVISIONING_RULES,
        ...SEND_TYPING_RULES,
        ...COMPONENT_ROUTING_RULES,
      ],

      // ============================================================================
      // MODULE SIZE & COMPLEXITY RULES
      // These prevent files from becoming too large and complex to test
      // Previously in .eslintrc.module-size.js but never integrated!
      // ============================================================================

      // Enforce maximum file length - error at 400, to force splitting large files
      'max-lines': [
        'error',
        {
          max: 400,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // Enforce maximum function length
      'max-lines-per-function': [
        'warn',
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],

      // Enforce maximum cyclomatic complexity
      // Bumped from 15 to 20 per MCP council review: Discord bots and AI pipelines
      // are inherently branch-heavy due to command routing and data validation
      complexity: ['warn', { max: 20 }],

      // Enforce maximum depth of nested blocks
      'max-depth': ['warn', { max: 4 }],

      // Enforce maximum number of parameters
      'max-params': ['warn', { max: 5 }],

      // Enforce maximum number of statements in a function
      // Bumped from 30 to 50 per MCP council review: orchestrator functions in
      // microservices naturally have many sequential steps (validate, fetch, process, save)
      'max-statements': ['warn', { max: 50 }],

      // Enforce maximum nested callbacks
      'max-nested-callbacks': ['warn', { max: 3 }],

      // ============================================================================
      // CUSTOM TZUROT RULES
      // ============================================================================

      // Detect singleton anti-patterns (export instantiated objects at module level)
      // Makes code harder to test because instances are created at import time
      '@tzurot/no-singleton-export': 'warn',

      // Enforce Discord's 3-second rule structurally: a BARE ack (deferUpdate/
      // deferReply/reply/update/showModal) in a component/modal interaction
      // handler must not FOLLOW awaited async work — either ack first, or route a
      // necessarily-late ack through a *WithTimeoutCatch wrapper. See
      // `.claude/rules/04-discord.md`. 'error' because a violation is a real bug —
      // the user gets no response.
      '@tzurot/component-handler-ack-first': 'error',

      // ============================================================================
      // SONARJS RULES - Additional code quality checks
      // ============================================================================

      // Cognitive complexity measures mental effort to understand code
      // More nuanced than cyclomatic complexity - penalizes nesting
      'sonarjs/cognitive-complexity': ['warn', 15],

      // Detect duplicate functions within the same file
      'sonarjs/no-identical-functions': 'warn',

      // Detect repeated string literals (magic strings)
      'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],

      // Additional quality rules
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/no-redundant-jump': 'warn',
      'sonarjs/prefer-immediate-return': 'warn',

      // ReDoS defense — catch super-linear regex backtracking / moves at lint time
      // rather than waiting for CodeQL to flag them post-push. We've shipped 5
      // separate ReDoS fixes (e.g., ERROR_SPOILER char-class, ERROR_SPOILER
      // unbounded quantifier, preset-clone nested quantifier, CHIMERA_ARTIFACT
      // `[\s]*`, polynomial-slide `\s*...\s*$`) that all reached CodeQL before
      // being caught — these two rules would have caught each one locally.
      //
      // - no-super-linear-backtracking: classic exponential ReDoS (nested quantifiers,
      //   overlapping alternatives that cause catastrophic backtracking).
      // - no-super-linear-move: polynomial-slide case where a pattern starting with an
      //   unbounded quantifier (e.g., `\s*literal`) causes O(n^2) matching attempts
      //   as the engine slides the match start position.
      'regexp/no-super-linear-backtracking': 'error',
      'regexp/no-super-linear-move': 'error',
    },
  },

  // Well-factored single-responsibility files that are large but don't benefit from splitting
  // Override criteria: single-class design, entrypoints/composition roots, clean API wrappers
  {
    files: [
      'services/bot-client/src/index.ts', // Entrypoint/composition root
      'services/bot-client/src/utils/dashboard/SessionManager.ts', // Exemplary single-class design
      'services/bot-client/src/utils/GatewayClient.ts', // Clean API wrapper, all methods share context
      'packages/conversation-history/src/ConversationHistoryService.ts', // Single-class CRUD/query service; retention/sync/mapping already split out
    ],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },

  // Identity Epic Phase 6: route handlers must not query users by discordId.
  // Replicates the main block's `no-restricted-syntax` rules and adds the
  // routes-only discordId-query ban. Placed BEFORE the persona/crud.ts +
  // UserService exemption below so that exemption wins for those files
  // (ESLint flat config merges rules in file order, last match wins).
  {
    files: ['services/api-gateway/src/routes/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PINO_LOGGER_RULES,
        ...IDENTITY_PROVISIONING_RULES,
        ...PROVISIONED_USER_ROUTE_RULES,
      ],
    },
  },

  // Files exempt from the prisma.user/persona.create ban (epic Phase 2).
  // These ARE the canonical creation sites — the ban exists to funnel every
  // other caller through them. Logger rules still apply via PINO_LOGGER_RULES.
  // Must come AFTER the routes-scoped identity override above so this
  // exemption wins for persona/crud.ts. `persona/override.ts` is included
  // for the create-persona-and-set-as-override flow: the work must run in
  // a single prisma.$transaction for atomicity, so factoring the persona
  // create out to UserService would split the transaction. The
  // deterministic-UUID invariant is still enforced by the explicit
  // `generatePersonaUuid(name, user.id)` call.
  // (UserService — now in @tzurot/identity — creates via a raw `$executeRaw`
  // CTE, not the ORM `.create` the ban targets, so it needs no exemption.)
  {
    files: [
      'services/api-gateway/src/routes/user/persona/crud.ts',
      'services/api-gateway/src/routes/user/persona/override.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...PINO_LOGGER_RULES],
    },
  },

  // Forward-safety guard for the envelope-building path. Replicates the main
  // block's bot-client `no-restricted-syntax` rules (flat config's last-match-
  // wins would otherwise drop them for these files) and adds the
  // FORWARD_SAFE_MESSAGE_READ_RULES ban on direct message.content/.attachments/
  // .embeds/.mentions reads. Scoped to where the trigger context is assembled —
  // the bug class is "a raw message-field read that's empty for a forward."
  {
    files: [
      'services/bot-client/src/services/contextBuilder/**/*.ts',
      'services/bot-client/src/services/MessageContextBuilder.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PINO_LOGGER_RULES,
        ...IDENTITY_PROVISIONING_RULES,
        ...SEND_TYPING_RULES,
        ...COMPONENT_ROUTING_RULES,
        ...FORWARD_SAFE_MESSAGE_READ_RULES,
      ],
    },
  },

  // Tooling package overrides - must come AFTER main config to take precedence
  // CLI tools need console.log for user output and have async stubs
  {
    files: ['packages/tooling/**/*.ts'],
    rules: {
      'no-console': 'off', // CLI tools output to console
      '@typescript-eslint/require-await': 'off', // Placeholder functions may not await yet
      '@typescript-eslint/strict-boolean-expressions': 'off', // CLI arg parsing has nullable checks
      'max-depth': ['warn', { max: 5 }], // ESLint rules can be deeply nested
      curly: 'off', // Allow compact conditional returns in CLI
      'no-restricted-syntax': 'off', // console.error is fine in CLI tools (not pino logger)
    },
  },

  // ── Test files ───────────────────────────────────────────────────────────
  // Tests were historically excluded from ESLint entirely (to dodge max-lines
  // noise), which also dropped correctness signal. Per council review we lint
  // them WITHOUT type-checking (the type-project cost over ~800 test files isn't
  // worth it; vitest/node already fail on unhandled rejections) and WITHOUT the
  // size/complexity family (handled by excluding tests from the main block).
  // What we DO enforce: vitest correctness rules + a fake-timer ban.
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    plugins: { vitest },
    languageOptions: {
      // No type-aware project — these rules are all syntactic.
      parserOptions: { projectService: false, project: false },
    },
    rules: {
      // Turn off every type-aware rule pulled in by the global
      // recommendedTypeChecked/stylisticTypeChecked spreads (they'd error with
      // no project). Keeps the syntactic js.configs.recommended rules on.
      ...tseslint.configs.disableTypeChecked.rules,
      // Syntactic rules that are legitimate in tests but noise as errors —
      // disabled per council review (mocks/fixtures need `any`, `!`, empty
      // stubs; Array<T> vs T[] and inferrable types are pure style).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/ban-ts-comment': 'off', // tests legitimately use @ts-expect-error
      // High-signal, low-false-positive vitest rules. no-unused-vars stays ON
      // (dead test imports are real).
      //
      // vitest/valid-expect is deliberately NOT enabled: it flags the deferred
      // fake-timer rejection idiom this codebase uses heavily (assign the
      // unawaited assertion, advance timers, then await it — see 02-code-standards.md
      // "Promise rejections with fake timers"), and its autofix rewrites that to
      // `await expect(...)` BEFORE the timer advance, deadlocking the test. The
      // rule cannot see the later await, so it's a false-positive generator whose
      // --fix actively breaks correct code.
      //
      // expect-expect: a test() with no assertion. assertFunctionNames teaches it
      // the project's custom assertion helpers + vitest's type-level matcher so
      // tests that assert through them aren't false-flagged.
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'expectTypeOf',
            'assertValidCustomId',
            'assertParentBeforeChild',
          ],
        },
      ],
      // A committed `.only`/`fit`/`fdescribe` silently limits the whole suite to
      // one test while CI stays green — highest-value test-lint guard, and nothing
      // else enforces it. `no-identical-title` catches copy-paste tests that forgot
      // a rename; `no-standalone-expect` catches assertions outside a test().
      // (`no-conditional-expect` was evaluated and dropped — 376 legitimate
      // error-path assertions inside `.catch`/conditionals make it pure noise here.)
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-standalone-expect': 'error',
      // Match the project's `_`-prefix escape hatch (intentional unused
      // params/vars in mock signatures) so it doesn't flood with false positives.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Unit tests only: ban real wall-clock delays. Component tests
  // (*.component.test.ts) legitimately wait on real Redis/PGLite I/O, so they're
  // exempt. The Date.now() ban was evaluated and dropped — 279 legitimate
  // non-timing uses (ID/timestamp generation) made it pure noise.
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    ignores: ['**/*.component.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Enforcement boundary: matches a *literal* positive delay only
          // (`setTimeout(fn, 100)`). It cannot catch `setTimeout(fn, TIMEOUT_MS)`
          // where the delay is an identifier — static analysis can't evaluate the
          // runtime value. The literal form is the common flake source; the
          // identifier form is rare in tests and accepted as a gap.
          selector:
            "CallExpression[callee.name='setTimeout'][arguments.1.type='Literal'][arguments.1.value>0]",
          message:
            'Real setTimeout delay in a unit test causes flakes — use vi.useFakeTimers() + vi.advanceTimersByTimeAsync(). Real delays are allowed in *.component.test.ts.',
        },
      ],
    },
  },
  // Component tests legitimately do things the production no-restricted-syntax
  // bans forbid: seed/query the users table directly (fixtures), and wait on real
  // Redis/PGLite I/O. Turning the rule off for them is a blunt instrument — it
  // disables ALL selectors, including ones not specific to route handlers (e.g.
  // the pino-logger ban), so a stray console.log in a component test would NOT be
  // caught here. That blast radius is accepted: component tests are fixture/IO code, not
  // production paths, and listing per-selector exceptions isn't worth the churn.
  //
  // Ordering contract: flat config is last-match-wins per rule, so this block MUST
  // remain the LAST one matching *.component.test.ts. It overrides the routes-scoped
  // block (`services/api-gateway/src/routes/**`) that would otherwise re-apply the
  // identity/discordId bans to component tests under routes/. If a later block matches
  // *.component.test.ts and sets no-restricted-syntax, it silently re-enables those bans.
  // Non-component test files keep the setTimeout ban via the block above.
  {
    files: ['**/*.component.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Barrel-kill regression guard: the @tzurot/common-types ROOT barrel is gone.
  // Import from a deep subpath. `paths` is EXACT-match, so deep specifiers
  // (…/types/jobs, …/services/prisma) are allowed — only the bare specifier is
  // banned. Deliberately NOT ignoring test files: both prior bare importers were
  // tests. String-literal fixtures that embed the specifier are not import nodes,
  // so they are not flagged (the CI `guard:no-bare-barrel` grep owns the
  // text-level allowlist). Catches STATIC imports only — dynamic `import('…')` is
  // invisible to this rule; the CI grep is the backstop for that.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tzurot/common-types',
              message:
                "The @tzurot/common-types root barrel was removed. Import from a deep subpath, e.g. '@tzurot/common-types/types/jobs', '@tzurot/common-types/constants/queue', '@tzurot/common-types/services/prisma'.",
            },
          ],
        },
      ],
      // Restore + enforce `import type` precision. The barrel-kill codemod's
      // mutate-in-place path dropped whole-import `isTypeOnly` markers on some
      // split imports; this rule (auto-fixable) restores them and prevents
      // recurrence. `inline-type-imports` aligns with the `import/no-duplicates`
      // prefer-inline setting so the fixer emits `import { type X }` directly
      // rather than a second `import type {}` statement it would then re-merge.
      // `disallowTypeAnnotations: false` keeps the legit `typeof import('…')`
      // type-query pattern (used for lazy-module typing in tests) allowed — this
      // rule is about import-STATEMENT precision, not banning inline type queries.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
    },
  },

  // Astro components (services/website). astro-eslint-parser makes .astro
  // files lintable (flat config otherwise silently skips them — none of the
  // .ts blocks above match, so the site's page/layout logic would get zero
  // ESLint coverage). Type-AWARE rules are disabled for .astro: projectService
  // can't resolve the virtual frontmatter modules, and `astro check` is the
  // type gate for these files.
  ...astroPlugin.configs['flat/recommended'],
  {
    files: ['**/*.astro'],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
    },
  }
);
