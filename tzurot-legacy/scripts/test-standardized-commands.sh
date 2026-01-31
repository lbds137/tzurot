#!/bin/bash

# Script for testing standardized command handlers
# This script helps with running tests and checking coverage for command handlers

# Display usage information
function show_usage {
  echo "Usage: $0 [option] [command_name]"
  echo ""
  echo "Options:"
  echo "  -l, --list        List all standardized command tests"
  echo "  -a, --all         Run all standardized command tests"
  echo "  -c, --coverage    Run with coverage report"
  echo "  -s, --standard    Run only tests with standardized format"
  echo "  -h, --help        Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 reset          # Run the reset command test"
  echo "  $0 -c list        # Run list command test with coverage report"
  echo "  $0 -a             # Run all standardized command tests"
  echo "  $0 -l             # List all standardized command tests"
  echo "  $0 -s             # Run only standardized format tests"
}

# Function to find all command tests
function find_command_tests {
  find ./tests/unit/commands/handlers -name "*.test.js" | sort
}

# Function to find standardized command tests
function find_standardized_tests {
  find ./tests/unit/commands/handlers -name "*.standardized.test.js" | sort
}

# If no arguments provided, show usage
if [ $# -eq 0 ]; then
  show_usage
  exit 1
fi

# Process command line arguments
with_coverage=false
run_all=false
run_standardized=false
list_tests=false
test_to_run=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -c|--coverage)
      with_coverage=true
      shift
      ;;
    -a|--all)
      run_all=true
      shift
      ;;
    -s|--standard)
      run_standardized=true
      shift
      ;;
    -l|--list)
      list_tests=true
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      test_to_run=$1
      shift
      ;;
  esac
done

# List all command tests
if [ "$list_tests" = true ]; then
  echo "Available command tests:"
  echo ""
  echo "Standard format tests:"
  find_standardized_tests | sed 's|./tests/unit/commands/handlers/||g' | sed 's|.test.js||g'
  echo ""
  echo "All command tests:"
  find_command_tests | sed 's|./tests/unit/commands/handlers/||g' | sed 's|.test.js||g'
  exit 0
fi

# Run all command tests
if [ "$run_all" = true ]; then
  if [ "$with_coverage" = true ]; then
    npx jest tests/unit/commands/handlers --coverage
  else
    npx jest tests/unit/commands/handlers
  fi
  exit 0
fi

# Run standardized tests only
if [ "$run_standardized" = true ]; then
  if [ "$with_coverage" = true ]; then
    standardized_tests=$(find_standardized_tests | tr '\n' ' ')
    npx jest $standardized_tests --coverage
  else
    standardized_tests=$(find_standardized_tests | tr '\n' ' ')
    npx jest $standardized_tests
  fi
  exit 0
fi

# Run a specific command test
if [ -n "$test_to_run" ]; then
  # First check for standardized version
  if [ -f "./tests/unit/commands/handlers/${test_to_run}.standardized.test.js" ]; then
    test_path="./tests/unit/commands/handlers/${test_to_run}.standardized.test.js"
  # Then check for regular version
  elif [ -f "./tests/unit/commands/handlers/${test_to_run}.test.js" ]; then
    test_path="./tests/unit/commands/handlers/${test_to_run}.test.js"
  # Finally check for paths without .test.js suffix
  elif [ -f "./tests/unit/commands/handlers/${test_to_run}" ]; then
    test_path="./tests/unit/commands/handlers/${test_to_run}"
  else
    echo "Error: Test for '${test_to_run}' command not found."
    echo "Available tests:"
    find_command_tests | sed 's|./tests/unit/commands/handlers/||g' | sed 's|.test.js||g'
    exit 1
  fi
  
  # Run the test with or without coverage
  if [ "$with_coverage" = true ]; then
    npx jest "$test_path" --coverage
  else
    npx jest "$test_path"
  fi
else
  echo "Error: No command specified to test."
  show_usage
  exit 1
fi