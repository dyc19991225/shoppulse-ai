/**
 * Dependency-free boolean parser shared by Node and Edge code (middleware
 * imports the rate limiter, which must not pull in `node:path`).
 */

export type Env = Record<string, string | undefined>;

/** Accepts 1/true/yes/on (case-insensitive) as truthy. */
export function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
