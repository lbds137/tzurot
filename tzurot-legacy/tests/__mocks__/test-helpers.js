/**
 * Test helpers for ensuring proper mocking/unmocking patterns
 *
 * CRITICAL: Always unmock the code you're testing!
 */

/**
 * Setup test with proper mock boundaries
 * Ensures the system under test is NOT mocked
 *
 * @param {string} moduleUnderTest - Path to the module being tested
 * @param {Array<string>} dependencies - Paths to modules that should be mocked
 * @param {Object} mockImplementations - Mock implementations for dependencies
 */
function setupTestWithProperMocks(moduleUnderTest, dependencies = [], mockImplementations = {}) {
  // First, ensure the module under test is NOT mocked
  jest.unmock(moduleUnderTest);

  // Mock all dependencies
  dependencies.forEach(dep => {
    jest.mock(dep, () => mockImplementations[dep] || {});
  });

  // Return the actual module under test
  return require(moduleUnderTest);
}

/**
 * Validate that required modules are properly set up
 * Call this in beforeEach to ensure consistency
 */
function validateTestSetup(config) {
  const {
    moduleUnderTest,
    mockedDependencies: _mockedDependencies = [],
    unmockedModules = [],
  } = config;

  // Check that module under test exists
  if (!moduleUnderTest) {
    throw new Error('Test setup error: moduleUnderTest must be specified');
  }

  // Ensure critical modules are not mocked
  const criticalUnmocked = [moduleUnderTest, ...unmockedModules];

  criticalUnmocked.forEach(modulePath => {
    // This is a bit tricky - we need to check if it's in the mock registry
    const mockRegistry = jest.getMockRegistry ? jest.getMockRegistry() : {};
    if (mockRegistry[modulePath]) {
      console.warn(`WARNING: ${modulePath} is mocked but should not be!`);
    }
  });

  return true;
}

/**
 * Create a test setup validator that can be reused
 */
function createTestValidator(config) {
  return {
    validate: () => validateTestSetup(config),

    getMockedModule: path => {
      if (!config.mockedDependencies.includes(path)) {
        throw new Error(`Module ${path} is not in the mocked dependencies list`);
      }
      return require(path);
    },

    getUnmockedModule: path => {
      if (config.mockedDependencies.includes(path)) {
        throw new Error(
          `Module ${path} is in the mocked dependencies list but you're trying to get unmocked version`
        );
      }
      jest.unmock(path);
      return require(path);
    },
  };
}

/**
 * Standard test setup patterns for DDD tests
 */
const dddTestPatterns = {
  /**
   * Domain model test - no external dependencies should be mocked
   */
  domainModelTest: modelPath => {
    // Ensure all domain dependencies are real
    jest.unmock(modelPath);
    jest.unmock(/domain/); // Unmock all domain modules

    return {
      moduleUnderTest: modelPath,
      mockedDependencies: [],
      unmockedModules: [
        /domain\//, // All domain modules should be real
      ],
    };
  },

  /**
   * Repository test - mock persistence layer but not domain
   */
  repositoryTest: (repositoryPath, config = {}) => {
    const dependencies = ['fs', /logger/, ...(config.additionalMocks || [])];

    // Unmock the repository and all domain modules
    jest.unmock(repositoryPath);
    jest.unmock(/domain/);

    dependencies.forEach(dep => jest.mock(dep));

    return {
      moduleUnderTest: repositoryPath,
      mockedDependencies: dependencies,
      unmockedModules: [/domain\//, repositoryPath],
    };
  },

  /**
   * Adapter test - mock external systems but not domain/application
   */
  adapterTest: (adapterPath, config = {}) => {
    const externalDependencies = [
      'discord.js',
      'node-fetch',
      'fs',
      /logger/,
      ...(config.additionalMocks || []),
    ];

    // Unmock adapter and all domain
    jest.unmock(adapterPath);
    jest.unmock(/domain/);
    jest.unmock(/application/);

    externalDependencies.forEach(dep => jest.mock(dep));

    return {
      moduleUnderTest: adapterPath,
      mockedDependencies: externalDependencies,
      unmockedModules: [/domain\//, /application\//, adapterPath],
    };
  },

  /**
   * Application service test - mock infrastructure but not domain
   */
  applicationServiceTest: (servicePath, config = {}) => {
    const infrastructureDeps = [
      /adapters/,
      /infrastructure/,
      /logger/,
      ...(config.additionalMocks || []),
    ];

    // Unmock service and domain
    jest.unmock(servicePath);
    jest.unmock(/domain/);

    infrastructureDeps.forEach(dep => jest.mock(dep));

    return {
      moduleUnderTest: servicePath,
      mockedDependencies: infrastructureDeps,
      unmockedModules: [/domain\//, servicePath],
    };
  },
};

/**
 * ESLint rule to enforce unmocking patterns
 * Add this to your test ESLint config
 */
const eslintTestRules = {
  'no-mock-system-under-test': {
    create(context) {
      return {
        CallExpression(node) {
          if (node.callee.name === 'describe') {
            const testFileName = context.getFilename();
            const match = testFileName.match(/(.+)\.test\.js$/);

            if (match) {
              const moduleBeingTested = match[1].replace('/tests/unit/', '/src/');

              // Check for jest.mock calls
              const sourceCode = context.getSourceCode();
              const mockCalls = sourceCode.ast.body.filter(
                stmt =>
                  stmt.type === 'ExpressionStatement' &&
                  stmt.expression.type === 'CallExpression' &&
                  stmt.expression.callee.type === 'MemberExpression' &&
                  stmt.expression.callee.object.name === 'jest' &&
                  stmt.expression.callee.property.name === 'mock'
              );

              mockCalls.forEach(mockCall => {
                const arg = mockCall.expression.arguments[0];
                if (arg && arg.type === 'Literal' && arg.value.includes(moduleBeingTested)) {
                  context.report({
                    node: mockCall,
                    message: `Do not mock the module under test: ${moduleBeingTested}`,
                  });
                }
              });
            }
          }
        },
      };
    },
  },
};

/**
 * Jest setup helper to add to test files
 */
function enforceProperMocking() {
  // Override jest.mock to add validation
  const originalMock = jest.mock;

  jest.mock = function (moduleName, ...args) {
    // Get the test file name from stack trace
    const stack = new Error().stack;
    const testFileMatch = stack.match(/at.*\((.+\.test\.js):/);

    if (testFileMatch) {
      const testFile = testFileMatch[1];
      const moduleUnderTest = testFile.replace(/\.test\.js$/, '').replace('/tests/unit/', '/src/');

      // Warn if mocking the module under test
      if (moduleName.includes(moduleUnderTest)) {
        console.warn(`
⚠️  WARNING: You are mocking the module under test!
Test file: ${testFile}
Module being tested: ${moduleUnderTest}
Mocked module: ${moduleName}

This means you're testing the mock, not the actual code!
        `);
      }
    }

    return originalMock.call(this, moduleName, ...args);
  };
}

module.exports = {
  setupTestWithProperMocks,
  validateTestSetup,
  createTestValidator,
  dddTestPatterns,
  eslintTestRules,
  enforceProperMocking,
};
