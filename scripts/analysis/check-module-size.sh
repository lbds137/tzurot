#!/bin/bash

# Script to check module sizes and test file organization
# This helps prevent modules from growing too large

set -e

echo "🔍 Checking module sizes and test organization..."

# Configuration
MAX_LINES=500
MAX_LINES_WARN=400
CRITICAL_MAX_LINES=1000
has_errors=0
has_warnings=0

# Color codes
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo ""
echo "📏 Checking for oversized modules..."
echo "   Max lines: $MAX_LINES (error), $MAX_LINES_WARN (warning)"
echo ""

# Check for files over the line limit
while IFS= read -r file; do
  # Skip vendor/node_modules directories
  if [[ "$file" == *"node_modules"* ]]; then
    continue
  fi
  
  lines=$(wc -l < "$file")
  
  if [ $lines -gt $CRITICAL_MAX_LINES ]; then
    echo -e "${RED}❌ CRITICAL: $file has $lines lines (max $MAX_LINES)${NC}"
    echo "   This file urgently needs to be broken into smaller modules!"
    has_errors=1
  elif [ $lines -gt $MAX_LINES ]; then
    echo -e "${RED}❌ ERROR: $file has $lines lines (max $MAX_LINES)${NC}"
    echo "   Consider breaking it into smaller modules"
    has_errors=1
  elif [ $lines -gt $MAX_LINES_WARN ]; then
    echo -e "${YELLOW}⚠️  WARNING: $file has $lines lines (warning at $MAX_LINES_WARN)${NC}"
    echo "   This module is getting large, consider refactoring"
    has_warnings=1
  fi
done < <(find src -name "*.js" -type f)

echo ""
echo "🧪 Checking for multiple test files per module..."
echo ""

# Track modules with multiple test files
declare -A test_counts
declare -A test_files

# Find all test files and group by module name
while IFS= read -r test_file; do
  # Extract the base module name (remove .test.js and any suffixes like .error, .embed)
  base_name=$(basename "$test_file" .test.js | sed 's/\.[^.]*$//')
  
  # Skip if base_name is empty
  if [ -z "$base_name" ]; then
    continue
  fi
  
  # Increment count for this module
  if [ -z "${test_counts[$base_name]}" ]; then
    test_counts["$base_name"]=1
  else
    ((test_counts["$base_name"]++))
  fi
  
  # Append test file to list
  if [ -z "${test_files[$base_name]}" ]; then
    test_files["$base_name"]="$test_file"
  else
    test_files["$base_name"]="${test_files[$base_name]}|$test_file"
  fi
done < <(find tests/unit -name "*.test.js" -type f 2>/dev/null)

# Report modules with multiple test files
for module in "${!test_counts[@]}"; do
  count=${test_counts[$module]}
  if [ $count -gt 1 ]; then
    echo -e "${YELLOW}⚠️  WARNING: Module '$module' has $count test files:${NC}"
    
    # Split and display test files
    IFS='|' read -ra files <<< "${test_files[$module]}"
    for file in "${files[@]}"; do
      echo "   - $file"
    done
    
    # Try to find the source file
    src_file=$(find src -name "${module}.js" -type f 2>/dev/null | head -1)
    if [ -n "$src_file" ]; then
      lines=$(wc -l < "$src_file")
      echo "   Source file: $src_file ($lines lines)"
      echo "   This suggests the module is doing too much and should be refactored"
    fi
    echo ""
    has_warnings=1
  fi
done

# Summary
echo ""
echo "📊 Summary:"
echo "============"

if [ $has_errors -eq 1 ]; then
  echo -e "${RED}❌ Errors found! Some modules exceed the size limit.${NC}"
  echo "   Please refactor large modules before committing."
elif [ $has_warnings -eq 1 ]; then
  echo -e "${YELLOW}⚠️  Warnings found. Some modules are getting large or have multiple test files.${NC}"
  echo "   Consider refactoring to prevent future issues."
else
  echo -e "${GREEN}✅ All modules are within size limits!${NC}"
fi

echo ""

# Exit with error if any errors were found
if [ $has_errors -eq 1 ]; then
  exit 1
fi

exit 0