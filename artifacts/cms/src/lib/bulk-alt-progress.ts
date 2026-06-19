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

/**
 * Persist the skipped URLs for a filter. Never throws.
 *
 * The write is a *union* with whatever is already persisted, not a blind
 * overwrite. Two tabs reviewing the same filter each hold their own in-memory
 * skip set; if one tab wrote its set verbatim it would clobber skips the other
 * tab had already persisted. Merging makes concurrent tabs converge on the
 * combined progress. (The skip set only ever grows within a pass and is dropped
 * wholesale via `clearSkipped` on completion, so union semantics never strand
 * stale entries.)
 */
export function saveSkipped(filter: string, urls: Iterable<string>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const merged = new Set(loadSkipped(filter));
    for (const url of urls) merged.add(url);
    storage.setItem(keyFor(filter), JSON.stringify([...merged]));
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

/**
 * Subscribe to cross-tab changes to a filter's persisted skip set.
 *
 * The browser fires a `storage` event in *other* tabs (never the one that made
 * the change) whenever localStorage is written. We use it so a skip made in one
 * tab is picked up by every other tab reviewing the same filter, keeping their
 * running progress in sync. `onChange` receives the freshly-loaded skip list.
 *
 * Returns an unsubscribe function. A no-op when storage/events are unavailable
 * (e.g. SSR or the test node env), so callers can wire it unconditionally.
 */
export function subscribeSkipped(
  filter: string,
  onChange: (urls: string[]) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => {};
  }
  const targetKey = keyFor(filter);
  const handler = (event: StorageEvent) => {
    // `key === null` means the whole store was cleared — treat it as a change.
    if (event.key !== null && event.key !== targetKey) return;
    onChange(loadSkipped(filter));
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
