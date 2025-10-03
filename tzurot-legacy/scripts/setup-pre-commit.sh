#!/bin/bash

# Setup script for pre-commit hooks

echo "🔧 Setting up pre-commit hooks..."

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

echo "🚀 Running pre-commit checks..."

# Check for test anti-patterns
echo "🔍 Checking for test anti-patterns..."
node scripts/check-test-antipatterns.js
if [ $? -ne 0 ]; then
    echo "❌ Pre-commit failed: Test anti-patterns found"
    exit 1
fi

# Run linting
echo "🔍 Running ESLint..."
npm run lint
if [ $? -ne 0 ]; then
    echo "❌ Pre-commit failed: Linting errors"
    exit 1
fi

# Run tests for changed files
echo "🧪 Running tests for changed files..."
CHANGED_TEST_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.test\.js$')
if [ ! -z "$CHANGED_TEST_FILES" ]; then
    npx jest $CHANGED_TEST_FILES --passWithNoTests
    if [ $? -ne 0 ]; then
        echo "❌ Pre-commit failed: Tests failed"
        exit 1
    fi
fi

echo "✅ All pre-commit checks passed!"
EOF

# Make pre-commit hook executable
chmod +x .git/hooks/pre-commit

echo "✅ Pre-commit hooks installed successfully!"
echo ""
echo "The following checks will run before each commit:"
echo "  1. Test anti-pattern detection"
echo "  2. ESLint code quality check"
echo "  3. Tests for changed test files"
echo ""
echo "To skip hooks (not recommended), use: git commit --no-verify"