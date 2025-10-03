# Contributing Guidelines

Thank you for considering contributing to Tzurot! This is a personal project, and I appreciate any help to make it better.

## Getting Started

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/tzurot.git
   cd tzurot
   ```
3. **Set up your development environment**
   - Install dependencies: `npm install`
   - Copy `.env.example` to `.env` and configure
   - Run tests: `npm test`

## How to Contribute

### Reporting Issues

- **Check existing issues** first to avoid duplicates
- **Use issue templates** when available
- **Provide details**: Node version, OS, error messages, steps to reproduce
- **Be patient**: This is a personal project maintained in spare time

### Suggesting Features

- **Open a discussion** first to talk about the idea
- **Explain the use case** - why would this be helpful?
- **Consider the scope** - does it fit with the bot's purpose?

### Submitting Code

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation as needed

3. **Run quality checks**
   ```bash
   npm run lint        # Check code style
   npm run lint:fix    # Fix style issues
   npm test           # Run all tests
   ```

4. **Commit your changes**
   - Write clear commit messages
   - Reference issues when applicable: "Fix #123: Description"

5. **Push and create a PR**
   - Push to your fork
   - Create a pull request with a clear description
   - Link any related issues

## Code Style

### JavaScript Standards

- **Use ESLint**: Run `npm run lint` before committing
- **Format with Prettier**: Run `npm run format`
- **Follow existing patterns** in the codebase

### Key Guidelines

```javascript
// Good: Clear variable names
const personalityName = 'friendly-bot';

// Bad: Unclear abbreviations
const pn = 'friendly-bot';

// Good: Async/await
try {
  const result = await someAsyncFunction();
} catch (error) {
  logger.error('Clear error message:', error);
}

// Good: JSDoc for exported functions
/**
 * Sends a message to the AI service
 * @param {string} message - User message
 * @returns {Promise<string>} AI response
 */
async function sendMessage(message) {
  // Implementation
}
```

## Testing

### Running Tests

```bash
npm test                    # Run all tests
npm run test:watch         # Watch mode
npx jest path/to/test.js   # Run specific test
```

### Writing Tests

- Place tests in `tests/unit/` mirroring the source structure
- Use descriptive test names
- Mock external dependencies
- Test both success and error cases

Example:
```javascript
describe('personalityManager', () => {
  it('should add a personality successfully', async () => {
    // Test implementation
  });

  it('should handle duplicate personality names', async () => {
    // Test error case
  });
});
```

## Documentation

### When to Update Docs

- **New features**: Add to COMMAND_SYSTEM.md or relevant docs
- **API changes**: Update API_REFERENCE.md
- **Configuration**: Update SETUP.md
- **Bug fixes**: Update TROUBLESHOOTING.md if relevant

### Documentation Style

- Use clear, simple language
- Include examples where helpful
- Keep formatting consistent
- Update the table of contents

## Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] PR description explains changes

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement

## Testing
How has this been tested?

## Related Issues
Fixes #(issue number)
```

## What Happens Next?

1. **I'll review your PR** as soon as I can (usually within a few days)
2. **I might request changes** - please don't take it personally!
3. **Once approved**, I'll merge your contribution
4. **You'll be credited** in the changelog

## Questions?

Feel free to:
- Open an issue for clarification
- Start a discussion
- Ask in your PR

## Code of Conduct

### Be Respectful

- **Be welcoming** to newcomers
- **Be patient** with questions
- **Be constructive** with feedback
- **Be understanding** - we all make mistakes

### Not Tolerated

- Harassment or discrimination
- Aggressive or insulting language
- Spam or off-topic content

## Recognition

Contributors will be:
- Credited in release notes
- Added to the contributors list
- Thanked publicly!

---

Remember: This is a personal project I work on for fun and learning. Every contribution, no matter how small, is appreciated. Thank you for helping make Tzurot better! 🎉