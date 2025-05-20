#!/bin/bash
# Script to run tests for all command handlers

echo "Running tests for command system..."

# Directory containing the command tests
TEST_DIR="tests/unit/commands"

# Run tests for the command system core
npx jest tests/unit/commandSystem.test.js
npx jest tests/unit/commandLoader.test.js

# Run tests for middleware
npx jest tests/unit/commands/middleware.test.js

# Find and run all command handler tests
COMMAND_TESTS=$(find "$TEST_DIR" -name "*.test.js" | sort)

if [ -z "$COMMAND_TESTS" ]; then
  echo "No command tests found in $TEST_DIR"
  exit 1
fi

echo "Found $(echo "$COMMAND_TESTS" | wc -l) command tests"
echo ""

# Run each test and collect results
FAILED_TESTS=()
PASSED_COUNT=0

for test_file in $COMMAND_TESTS; do
  echo "Running test: $test_file"
  npx jest "$test_file"
  
  if [ $? -eq 0 ]; then
    ((PASSED_COUNT++))
  else
    FAILED_TESTS+=("$test_file")
  fi
  
  echo ""
done

# Print summary
echo "========== TEST SUMMARY =========="
echo "Total tests: $(echo "$COMMAND_TESTS" | wc -l)"
echo "Passed: $PASSED_COUNT"
echo "Failed: ${#FAILED_TESTS[@]}"

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for failed in "${FAILED_TESTS[@]}"; do
    echo "  - $failed"
  done
  exit 1
fi

echo ""
echo "All command tests passed successfully!"