/**
 * Stateful allocator for unique anchor ids within a single page.
 *
 * Crawled/imported source HTML frequently repeats the same element `id`
 * (for example a junk `3a` shared by many sections). Carrying those over
 * verbatim produces duplicate DOM ids, so every in-article "jump to section"
 * link resolves to the first match. This allocator takes a preferred base
 * (normally the slug of the heading text) and guarantees uniqueness across the
 * whole page by appending a numeric suffix on collision (`base`, `base-2`, …).
 *
 * Create one allocator per page and call it for each section/heading in
 * document order so the first, most prominent occurrence keeps the clean id.
 */
export function createAnchorAllocator(): (preferred?: string | null) => string {
  const used = new Set<string>();
  return (preferred?: string | null): string => {
    const base = (preferred ?? "").trim() || "section";
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let i = 2;
    while (used.has(`${base}-${i}`)) i += 1;
    const id = `${base}-${i}`;
    used.add(id);
    return id;
  };
}
