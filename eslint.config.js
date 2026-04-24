import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sonarjs from 'eslint-plugin-sonarjs';
import * as regexpPlugin from 'eslint-plugin-regexp';
import tzurotPlugin from './packages/tooling/dist/eslint/index.js';

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
const IDENTITY_PROVISIONING_RULES = [
  {
    selector:
      "CallExpression[callee.property.name=/^(create|upsert|createMany)$/][callee.object.property.name='user']",
    message:
      'Direct prisma.user.create/upsert/createMany is banned outside UserService. Use userService.getOrCreateUser (for Discord-interaction paths with username) or userService.getOrCreateUserShell (for HTTP routes). See epic-identity-hardening.md Phase 2.',
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
      '**/*.test.ts',
      '**/*.spec.ts',
      'coverage/**',
      '.pnpm-store/**',
      '**/vitest.config.ts',
      'vitest.workspace.ts',
      'prisma.config.ts',
      'tzurot-legacy/**',
      'scripts/**',
      '**/scripts/**',
      'prisma/**',
      // Un-ignore generated Prisma files so ESLint can parse them for type resolution
      // (negation brings them back into scope for the parser)
      '!packages/common-types/src/generated/**',
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

  // Configuration for TypeScript files
  {
    files: ['**/*.ts'],
    plugins: {
      '@tzurot': tzurotPlugin,
      sonarjs,
      regexp: regexpPlugin,
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
      'no-restricted-syntax': ['error', ...PINO_LOGGER_RULES, ...IDENTITY_PROVISIONING_RULES],

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
  // exemption wins for persona/crud.ts.
  {
    files: [
      'packages/common-types/src/services/UserService.ts',
      'services/api-gateway/src/routes/user/persona/crud.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...PINO_LOGGER_RULES],
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
  }
);
