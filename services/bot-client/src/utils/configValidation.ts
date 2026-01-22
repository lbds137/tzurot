/**
 * Shared Configuration Validation Framework
 *
 * A reusable fluent API for validating configuration objects.
 * Supports both errors (block save) and warnings (allow save with caution).
 *
 * Usage:
 * ```typescript
 * const validator = new ConfigValidator<MyConfig>()
 *   .addError('field', (c) => c.value < 0, 'Value must be positive')
 *   .addWarning('field', (c) => c.value > 100, 'Value seems high');
 *
 * const result = validator.validate(myConfig);
 * if (!result.isValid) {
 *   // Show errors and block save
 * }
 * ```
 */

import { EmbedBuilder } from 'discord.js';
import { createWarningEmbed, createErrorEmbed } from './commandHelpers.js';

// ============================================
// SHARED VALIDATION TYPES
// ============================================

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ValidationResult {
  /** true if no errors (warnings are OK) */
  isValid: boolean;
  /** All issues (errors + warnings) */
  issues: ValidationIssue[];
  /** Convenience: only errors */
  errors: ValidationIssue[];
  /** Convenience: only warnings */
  warnings: ValidationIssue[];
}

// ============================================
// VALIDATION RULE BUILDER (Fluent API)
// ============================================

/**
 * Generic configuration validator with fluent API.
 *
 * @example
 * ```typescript
 * const validator = new ConfigValidator<PresetConfig>()
 *   .addError('minP / topA', (c) => c.minP > 0 && c.topA > 0, 'Use one, not both')
 *   .addWarning('temperature', (c) => c.temperature > 1.5, 'May produce incoherent output');
 *
 * const result = validator.validate(config);
 * ```
 */
export class ConfigValidator<T> {
  private rules: ((config: T) => ValidationIssue | null)[] = [];

  /**
   * Add error rule (blocks save).
   * Error rules indicate the configuration is invalid and cannot be saved.
   *
   * @param field - Field name for grouping in UI
   * @param condition - Returns true if there's an error
   * @param message - Error message to display
   */
  addError(field: string, condition: (config: T) => boolean, message: string): this {
    this.rules.push(config => (condition(config) ? { severity: 'error', field, message } : null));
    return this;
  }

  /**
   * Add warning rule (allows save with caution).
   * Warning rules indicate questionable but valid configuration.
   *
   * @param field - Field name for grouping in UI
   * @param condition - Returns true if there's a warning
   * @param message - Warning message to display
   */
  addWarning(field: string, condition: (config: T) => boolean, message: string): this {
    this.rules.push(config => (condition(config) ? { severity: 'warning', field, message } : null));
    return this;
  }

  /**
   * Validate config against all rules.
   *
   * @param config - Configuration object to validate
   * @returns Validation result with issues categorized
   */
  validate(config: T): ValidationResult {
    const issues = this.rules
      .map(rule => rule(config))
      .filter((issue): issue is ValidationIssue => issue !== null);

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    return {
      isValid: errors.length === 0,
      issues,
      errors,
      warnings,
    };
  }

  /**
   * Get the number of rules registered.
   * Useful for testing.
   */
  get ruleCount(): number {
    return this.rules.length;
  }
}

// ============================================
// EMBED BUILDERS (integrate with existing utils)
// ============================================

/**
 * Build embed showing validation issues.
 * Uses existing embed utilities for consistent styling.
 *
 * @param result - Validation result from ConfigValidator
 * @returns EmbedBuilder or null if no issues
 */
export function buildValidationEmbed(result: ValidationResult): EmbedBuilder | null {
  if (result.issues.length === 0) {
    return null;
  }

  const hasErrors = result.errors.length > 0;
  const embed = hasErrors
    ? createErrorEmbed('Configuration Issues', 'Please fix these issues before saving:')
    : createWarningEmbed('Configuration Warnings', 'Your config will be saved, but consider:');

  // Group issues by field
  const byField = new Map<string, ValidationIssue[]>();
  for (const issue of result.issues) {
    const existing = byField.get(issue.field) ?? [];
    byField.set(issue.field, [...existing, issue]);
  }

  // Add fields to embed
  for (const [field, fieldIssues] of byField) {
    const hasFieldError = fieldIssues.some(i => i.severity === 'error');
    const icon = hasFieldError ? '❌' : '⚠️';
    const messages = fieldIssues.map(i => i.message).join('\n');
    embed.addFields({ name: `${icon} ${field}`, value: messages, inline: false });
  }

  return embed;
}

/**
 * Check if validation allows proceeding with save.
 * Returns true if there are no errors (warnings are OK).
 *
 * @param result - Validation result from ConfigValidator
 */
export function canProceed(result: ValidationResult): boolean {
  return result.isValid;
}

/**
 * Format validation issues as a simple string list.
 * Useful for logging or non-embed contexts.
 *
 * @param result - Validation result from ConfigValidator
 */
export function formatValidationIssues(result: ValidationResult): string {
  if (result.issues.length === 0) {
    return 'No issues found';
  }

  return result.issues
    .map(issue => {
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      return `${icon} [${issue.field}] ${issue.message}`;
    })
    .join('\n');
}
