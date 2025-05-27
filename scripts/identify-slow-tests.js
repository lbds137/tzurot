#!/usr/bin/env node

/**
 * Script to identify slow test files
 * Runs each test file individually and measures execution time
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const glob = require('glob');

async function measureTestFile(testFile) {
  try {
    const start = Date.now();
    
    // Run test with no coverage to speed it up
    execSync(`npx jest ${testFile} --no-coverage --silent`, {
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    const duration = Date.now() - start;
    return { file: testFile, duration, passed: true };
  } catch (error) {
    const duration = Date.now() - start;
    return { file: testFile, duration, passed: false };
  }
}

async function main() {
  console.log('Analyzing test execution times...\n');
  
  // Get all test files
  const testFiles = glob.sync('tests/unit/**/*.test.js', {
    cwd: process.cwd()
  });
  
  console.log(`Found ${testFiles.length} test files to analyze.\n`);
  
  // Sample a subset for quick analysis
  const sampled = testFiles
    .sort(() => Math.random() - 0.5)
    .slice(0, 20); // Just test 20 random files
  
  const results = [];
  
  for (const file of sampled) {
    process.stdout.write(`Testing ${path.basename(file)}...`);
    const result = await measureTestFile(file);
    results.push(result);
    console.log(` ${result.duration}ms ${result.passed ? '✓' : '✗'}`);
  }
  
  // Sort by duration
  results.sort((a, b) => b.duration - a.duration);
  
  console.log('\n=== SLOWEST TESTS ===');
  console.log('Duration | File');
  console.log('---------|-----');
  
  results.slice(0, 10).forEach(result => {
    const seconds = (result.duration / 1000).toFixed(1);
    const flag = result.duration > 5000 ? '🔴' : result.duration > 2000 ? '🟡' : '🟢';
    console.log(`${flag} ${seconds}s | ${result.file}`);
  });
  
  // Check for common patterns in slow tests
  console.log('\n=== ANALYSIS ===');
  
  const slowTests = results.filter(r => r.duration > 2000);
  
  if (slowTests.length > 0) {
    console.log(`\n${slowTests.length} tests took longer than 2 seconds.`);
    
    // Check for common patterns
    const patterns = {
      personalityHandler: 0,
      webhookManager: 0,
      bot: 0,
      aiService: 0,
      commands: 0
    };
    
    slowTests.forEach(test => {
      Object.keys(patterns).forEach(pattern => {
        if (test.file.includes(pattern)) {
          patterns[pattern]++;
        }
      });
    });
    
    console.log('\nSlow test patterns:');
    Object.entries(patterns)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} slow tests`);
      });
  }
  
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  console.log(`\nAverage test duration: ${(avgDuration / 1000).toFixed(1)}s`);
  
  if (avgDuration > 1000) {
    console.log('\n⚠️  Average test duration is too high!');
    console.log('Most tests should complete in under 1 second.');
  }
}

main().catch(console.error);