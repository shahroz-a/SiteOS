/**
 * Persistence for an in-progress bulk alt-text suggestion pass.
 *
 * A pass walks the whole flagged-image backlog one window at a time. Images the
 * editor *skips* stay flagged on the server, so without persistence they'd be
 * re-suggested every time the dialog is reopened. We persist the set of skipped
 * URLs (scoped to the active search filter) so an editor can close the dialog
 * mid-pass — or reload the page — and resume without re-reviewing them.
 *
 * Approved images don't need persisting to *resume* a pass — saving alt text
 * clears their server flag, so the next pass's gather naturally excludes them.
 * But two tabs running the same pass concurrently can briefly contradict each
 * other: an image approved in one tab can still sit pending in the other,
 * getting re-suggested and re-counted before the server flag propagates. So we
 * also persist a url→alt map of images approved *this pass* (scoped to the same
 * filter) purely as a cross-tab sync channel — a tab that approves writes it,
 * and every other tab on the same filter folds it into its own progress via the
 * `storage` event. The map carries the saved alt so a peer tab can show the
 * exact text that was approved, not a placeholder.
 */

const KEY_PREFIX = "headout-cms:bulk-alt-skipped:";
const KEY_PREFIX_APPROVED = "headout-cms:bulk-alt-approved:";

/** Storage key for a given search filter (empty string = whole library). */
function keyFor(filter: string): string {
  return `${KEY_PREFIX}${filter}`;
}

/** Approved-channel storage key for a given search filter. */
function approvedKeyFor(filter: string): string {
  return `${KEY_PREFIX_APPROVED}${filter}`;
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
 * Authoritatively replace the persisted skipped set for a filter with exactly
 * `urls` (removing the key entirely when empty). Never throws.
 *
 * This is the counterpart to `saveSkipped`'s union/grow semantics: `saveSkipped`
 * can only ever *add* URLs, so it can't honour an intentional *shrink* — when a
 * pass pulls its skips back in for review, forgets them, or promotes one to an
 * approval, the new (smaller) set must overwrite, not merge. Callers that need
 * to reduce the persisted set use this; callers that record a new skip keep
 * using `saveSkipped` so concurrent tabs each adding skips still converge.
 */
export function replaceSkipped(filter: string, urls: Iterable<string>): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const next = [...new Set(urls)];
    if (next.length === 0) {
      storage.removeItem(keyFor(filter));
    } else {
      storage.setItem(keyFor(filter), JSON.stringify(next));
    }
  } catch {
    // Quota exceeded or storage unavailable — progress is best-effort.
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

/** Load the persisted approved url→alt map for a filter. Never throws. */
export function loadApproved(filter: string): Record<string, string> {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(approvedKeyFor(filter));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [url, alt] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof alt === "string") out[url] = alt;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persist approved url→alt entries for a filter. Never throws.
 *
 * Like `saveSkipped`, the write is a *union* (merge) with whatever is already
 * persisted, not a blind overwrite — so two tabs each holding their own
 * in-memory approved set converge on the combined progress instead of one
 * clobbering the other. Later writes for the same URL win (the alt was just
 * re-saved). The map only grows within a pass and is dropped wholesale via
 * `clearApproved` on completion, so the union never strands stale entries.
 */
export function saveApproved(
  filter: string,
  entries: Record<string, string>,
): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const merged = { ...loadApproved(filter), ...entries };
    storage.setItem(approvedKeyFor(filter), JSON.stringify(merged));
  } catch {
    // Quota exceeded or storage unavailable — progress is best-effort.
  }
}

/** Drop any persisted approved state for a filter (e.g. once a pass completes). */
export function clearApproved(filter: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(approvedKeyFor(filter));
  } catch {
    // Ignore.
  }
}

/**
 * Subscribe to cross-tab changes to a filter's persisted approved map. Mirrors
 * `subscribeSkipped`: the browser fires a `storage` event in *other* tabs
 * whenever localStorage is written, so an approval made in one tab is picked up
 * by every other tab reviewing the same filter. `onChange` receives the freshly
 * loaded approved map. Returns an unsubscribe function; a no-op when
 * storage/events are unavailable.
 */
export function subscribeApproved(
  filter: string,
  onChange: (entries: Record<string, string>) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => {};
  }
  const targetKey = approvedKeyFor(filter);
  const handler = (event: StorageEvent) => {
    // `key === null` means the whole store was cleared — treat it as a change.
    if (event.key !== null && event.key !== targetKey) return;
    onChange(loadApproved(filter));
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
