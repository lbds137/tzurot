#!/bin/bash

# Fast test runner - disables coverage and other slow features

echo "🚀 Running tests with performance optimizations..."
echo ""

# Run Jest with performance optimizations
npx jest \
  --no-coverage \
  --silent \
  --maxWorkers=4 \
  --cache \
  "$@"

# Time the full test suite
if [ $# -eq 0 ]; then
  echo ""
  echo "💡 Tips for faster tests:"
  echo "  - Use --watch for development"
  echo "  - Run specific test files: npm run test:fast path/to/test.js"
  echo "  - Use --bail to stop on first failure"
fi