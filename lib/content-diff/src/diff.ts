/**
 * Pure, DOM-free diff helpers powering the importer fidelity view. They compare
 * the *source* article body against the *parsed* (imported) body at the block,
 * word, and URL level so an editor can see exactly what the importer dropped or
 * garbled.
 *
 * Everything here is deliberately framework-agnostic and side-effect free so it
 * can be unit-tested in the node vitest environment and reused by both the web
 * CMS (DOM extraction) and the mobile companion (pure tree/HTML extraction).
 */

export interface WordSeg {
  type: "equal" | "removed" | "added";
  text: string;
}

export type BlockKind = "equal" | "removed" | "added" | "changed";

export interface DiffBlock {
  kind: BlockKind;
  /** Index into the source block list, or null for importer-only blocks. */
  sourceIndex: number | null;
  /** Index into the parsed block list, or null for source-only blocks. */
  parsedIndex: number | null;
  sourceText: string;
  parsedText: string;
  /** Word-level diff, only populated for `changed` blocks. */
  words: WordSeg[] | null;
}

export interface BlockDiff {
  blocks: DiffBlock[];
  /** Blocks present in source but entirely absent from parsed. */
  dropped: number;
  /** Blocks the importer produced that have no source counterpart. */
  added: number;
  /** Blocks that survived but whose text changed (paired by similarity). */
  changed: number;
}

/** Two blocks pair up as "changed" (not removed+added) above this overlap. */
const SIMILARITY_THRESHOLD = 0.4;

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

type Op =
  | { type: "equal"; a: number; b: number }
  | { type: "removed"; a: number }
  | { type: "added"; b: number };

/** Longest-common-subsequence alignment, returned as an ordered op list. */
function lcsOps<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      ops.push({ type: "equal", a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "removed", a: i });
      i++;
    } else {
      ops.push({ type: "added", b: j });
      j++;
    }
  }
  while (i < n) ops.push({ type: "removed", a: i++ });
  while (j < m) ops.push({ type: "added", b: j++ });
  return ops;
}

function pushWord(segs: WordSeg[], type: WordSeg["type"], word: string): void {
  const last = segs[segs.length - 1];
  if (last && last.type === type) {
    last.text += ` ${word}`;
  } else {
    segs.push({ type, text: word });
  }
}

/** Word-level diff between two block strings (for "changed" blocks). */
export function diffWords(source: string, parsed: string): WordSeg[] {
  const a = source.split(/\s+/).filter(Boolean);
  const b = parsed.split(/\s+/).filter(Boolean);
  const ops = lcsOps(a, b, (x, y) => x.toLowerCase() === y.toLowerCase());
  const segs: WordSeg[] = [];
  for (const op of ops) {
    if (op.type === "equal") pushWord(segs, "equal", a[op.a]);
    else if (op.type === "removed") pushWord(segs, "removed", a[op.a]);
    else pushWord(segs, "added", b[op.b]);
  }
  return segs;
}

/**
 * Block-level diff. Equal blocks are matched by exact normalized text; the
 * remaining removed/added runs between two matches are paired by word overlap
 * so a lightly edited paragraph reads as a single "changed" block rather than a
 * confusing removed+added pair.
 */
export function diffBlocks(
  sourceTexts: string[],
  parsedTexts: string[],
): BlockDiff {
  const aNorm = sourceTexts.map(normalizeText);
  const bNorm = parsedTexts.map(normalizeText);
  const ops = lcsOps(aNorm, bNorm, (x, y) => x.length > 0 && x === y);

  const blocks: DiffBlock[] = [];
  let pendingRem: number[] = [];
  let pendingAdd: number[] = [];

  const flush = () => {
    if (pendingRem.length === 0 && pendingAdd.length === 0) return;
    const remTokens = pendingRem.map((i) => tokenize(sourceTexts[i]));
    const addTokens = pendingAdd.map((j) => tokenize(parsedTexts[j]));
    const usedAdd = new Set<number>();
    const region: DiffBlock[] = [];

    for (let ri = 0; ri < pendingRem.length; ri++) {
      let best = -1;
      let bestSim = SIMILARITY_THRESHOLD;
      for (let ai = 0; ai < pendingAdd.length; ai++) {
        if (usedAdd.has(ai)) continue;
        const sim = jaccard(remTokens[ri], addTokens[ai]);
        if (sim >= bestSim) {
          bestSim = sim;
          best = ai;
        }
      }
      const si = pendingRem[ri];
      if (best >= 0) {
        usedAdd.add(best);
        const pj = pendingAdd[best];
        region.push({
          kind: "changed",
          sourceIndex: si,
          parsedIndex: pj,
          sourceText: sourceTexts[si],
          parsedText: parsedTexts[pj],
          words: diffWords(sourceTexts[si], parsedTexts[pj]),
        });
      } else {
        region.push({
          kind: "removed",
          sourceIndex: si,
          parsedIndex: null,
          sourceText: sourceTexts[si],
          parsedText: "",
          words: null,
        });
      }
    }
    for (let ai = 0; ai < pendingAdd.length; ai++) {
      if (usedAdd.has(ai)) continue;
      const pj = pendingAdd[ai];
      region.push({
        kind: "added",
        sourceIndex: null,
        parsedIndex: pj,
        sourceText: "",
        parsedText: parsedTexts[pj],
        words: null,
      });
    }
    region.sort((x, y) => {
      const xs = x.sourceIndex ?? Number.MAX_SAFE_INTEGER;
      const ys = y.sourceIndex ?? Number.MAX_SAFE_INTEGER;
      if (xs !== ys) return xs - ys;
      return (x.parsedIndex ?? 0) - (y.parsedIndex ?? 0);
    });
    blocks.push(...region);
    pendingRem = [];
    pendingAdd = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      blocks.push({
        kind: "equal",
        sourceIndex: op.a,
        parsedIndex: op.b,
        sourceText: sourceTexts[op.a],
        parsedText: parsedTexts[op.b],
        words: null,
      });
    } else if (op.type === "removed") {
      pendingRem.push(op.a);
    } else {
      pendingAdd.push(op.b);
    }
  }
  flush();

  let dropped = 0;
  let added = 0;
  let changed = 0;
  for (const b of blocks) {
    if (b.kind === "removed") dropped++;
    else if (b.kind === "added") added++;
    else if (b.kind === "changed") changed++;
  }
  return { blocks, dropped, added, changed };
}

/**
 * Normalize a URL for set membership: drops the origin so source-relative and
 * parsed-absolute links to the same path compare equal, strips the hash, the
 * query, and a trailing slash, and rejects non-navigational targets.
 */
export function normalizeUrl(u: string): string {
  const s = u.trim();
  if (
    !s ||
    s.startsWith("#") ||
    s.startsWith("javascript:") ||
    s.startsWith("mailto:") ||
    s.startsWith("tel:") ||
    s.startsWith("data:")
  ) {
    return "";
  }
  try {
    const url = new URL(s, "https://base.local/");
    return url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return s
      .replace(/[#?].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

/** Which source URLs are missing from parsed, and which are importer-only. */
export function diffUrlSets(
  sourceUrls: string[],
  parsedUrls: string[],
): { missing: string[]; extra: string[] } {
  const parsedSet = new Set(parsedUrls.map(normalizeUrl).filter(Boolean));
  const sourceSet = new Set(sourceUrls.map(normalizeUrl).filter(Boolean));
  const missing = sourceUrls.filter((u) => {
    const n = normalizeUrl(u);
    return n.length > 0 && !parsedSet.has(n);
  });
  const extra = parsedUrls.filter((u) => {
    const n = normalizeUrl(u);
    return n.length > 0 && !sourceSet.has(n);
  });
  return { missing, extra };
}
