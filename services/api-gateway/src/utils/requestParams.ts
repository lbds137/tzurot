/**
 * Request Parameter Utilities
 *
 * Express route params can be string | string[] in the type definitions.
 * These utilities safely extract single string values from params.
 */

/**
 * Extract a single string value from a route param.
 * Express params can be string | string[] | undefined.
 * This returns the first value if array, or the string itself.
 *
 * @param param - The route param value (string | string[] | undefined)
 * @returns The string value, or undefined if not present
 */
export function getParam(param: string | string[] | undefined): string | undefined {
  if (param === undefined) {
    return undefined;
  }
  if (Array.isArray(param)) {
    return param[0];
  }
  return param;
}

/**
 * Extract a required string value from a route param.
 * Throws if the param is missing or empty.
 *
 * @param param - The route param value
 * @param paramName - Name of the param for error message
 * @returns The string value
 * @throws Error if param is missing
 */
export function getRequiredParam(param: string | string[] | undefined, paramName: string): string {
  const value = getParam(param);
  if (value === undefined || value === '') {
    throw new Error(`Missing required parameter: ${paramName}`);
  }
  return value;
}
