/**
 * Persistence for an in-progress bulk alt-text suggestion pass.
 *
 * A pass walks the whole flagged-image backlog one window at a time. Images the
 * editor *skips* stay flagged on the server, so without persistence they'd be
 * re-suggested every time the dialog is reopened. We persist the set of skipped
 * URLs (scoped to the active search filter) so an editor can close the dialog
 * mid-pass — or reload the page — and resume without re-reviewing them.
 *
 * Approved images don't need persisting: saving alt text clears their flag, so
 * the server-side gather naturally excludes them on the next pass.
 */

const KEY_PREFIX = "headout-cms:bulk-alt-skipped:";

/** Storage key for a given search filter (empty string = whole library). */
function keyFor(filter: string): string {
  return `${KEY_PREFIX}${filter}`;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Load the persisted skipped URLs for a filter. Never throws. */
export function loadSkipped(filter: string): string[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(keyFor(filter));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/** Persist the full set of skipped URLs for a filter. Never throws. */
export function saveSkipped(filter: string, urls: Iterable<string>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(keyFor(filter), JSON.stringify([...urls]));
  } catch {
    // Quota exceeded or storage unavailable — progress is best-effort.
  }
}

/** Drop any persisted skipped state for a filter (e.g. once a pass completes). */
export function clearSkipped(filter: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(keyFor(filter));
  } catch {
    // Ignore.
  }
}
