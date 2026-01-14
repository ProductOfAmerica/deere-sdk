/**
 * Utility functions for fixing broken OpenAPI specs.
 * Extracted for testability.
 */

/**
 * Checks if a property key is entirely an HTML documentation marker.
 * e.g., "<b>Location</b>" or "<span>Section</span>"
 */
export function isDocumentationKey(key: string): boolean {
  return /^<.*>$/.test(key);
}

/**
 * Strips HTML elements from property keys.
 * e.g., "createdTime<sup><a href='#foo'>2</a></sup>" → "createdTime"
 * e.g., "referenceId<sup>DEPRECATED</sup>" → "referenceId"
 */
export function sanitizePropertyKey(key: string): string {
  return key
    .replace(/<sup>.*?<\/sup>/gi, '') // Remove entire <sup>...</sup> blocks
    .replace(/<[^>]*>/g, ''); // Remove any remaining standalone tags
}
