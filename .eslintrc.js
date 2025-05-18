module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:jest/recommended',
    'prettier'
  ],
  env: {
    node: true,
    commonjs: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022
  },
  plugins: ['jest'],
  rules: {
    'no-unused-vars': 'warn',
    'no-console': 'off',
    'no-var': 'warn',
    'prefer-const': 'warn',
    'jest/no-disabled-tests': 'warn',
    'jest/no-focused-tests': 'error'
  },
  ignorePatterns: ['node_modules/**', 'coverage/**']
};