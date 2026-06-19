/**
 * High-level source-vs-parsed importer diff, computed entirely from the raw
 * source endpoint payload (no DOM, no rendering required). Both the web CMS and
 * the mobile companion can render the same fidelity view from this result, so
 * the diff can't drift between surfaces.
 */
import {
  diffBlocks,
  normalizeUrl,
  type BlockKind,
  type DiffBlock,
  type WordSeg,
} from "./diff";
import {
  extractHtmlContent,
  extractTreeContent,
  type ExtractedImage,
  type ExtractedLink,
} from "./extract";

/** The structural shape needed from a source endpoint (held-back or per-post). */
export interface SourceDiffInput {
  sourceHtml: string | null;
  sourceKind?: "cleaned" | "original" | null;
  componentTree: unknown;
  richText: unknown;
}

export interface DiffBlockView {
  text: string;
  kind: BlockKind;
  /** Word-level diff for `changed` blocks (what the importer garbled). */
  words?: WordSeg[] | null;
  /** The parsed counterpart text for `changed` blocks. */
  parsedText?: string;
}

export interface SourceDiffResult {
  /** Whether the article stored any source HTML at all. */
  hasSource: boolean;
  /** Whether the importer produced any structured (tree/richText) content. */
  hasParsed: boolean;
  /** Source blocks, each tagged with how it fared in the importer. */
  sourceBlocks: DiffBlockView[];
  /** Parsed blocks, with importer-only blocks tagged `added`. */
  parsedBlocks: DiffBlockView[];
  /** Source images the importer didn't carry over. */
  missingImages: ExtractedImage[];
  /** Source links the importer didn't carry over. */
  droppedLinks: ExtractedLink[];
  counts: {
    dropped: number;
    changed: number;
    added: number;
    missingImages: number;
    droppedLinks: number;
  };
  /**
   * Total fidelity *losses* — dropped + changed blocks + missing images +
   * dropped links. Importer-added blocks are reported in counts but excluded
   * here (they aren't content lost from the source).
   */
  total: number;
}

/** The kinds of fidelity loss a reviewer can step through. */
export type DiffMarkerType = "removed" | "changed" | "image" | "link";

/**
 * One navigable difference, in top-to-bottom reading order. `index` points into
 * the relevant `SourceDiffResult` array so a renderer can locate the element to
 * highlight/scroll to:
 *  - `removed` / `changed` → `sourceBlocks`
 *  - `image` → `missingImages`
 *  - `link` → `droppedLinks`
 */
export interface DiffMarker {
  type: DiffMarkerType;
  /** Short human label for the marker list / counter. */
  label: string;
  index: number;
}

/** Collapse whitespace and clip a label so the marker list stays compact. */
export function truncateLabel(s: string, n = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * Flatten a `SourceDiffResult` into the ordered list of differences a reviewer
 * steps through (Prev/Next). The order — dropped/changed source blocks first
 * (in document order), then missing images, then dropped links — matches the
 * order the mobile companion renders these sections, so stepping walks the
 * screen top-to-bottom. Importer-added blocks are intentionally excluded (they
 * are not content lost from the source).
 */
export function buildDiffMarkers(result: SourceDiffResult): DiffMarker[] {
  const markers: DiffMarker[] = [];
  result.sourceBlocks.forEach((block, index) => {
    if (block.kind === "removed" || block.kind === "changed") {
      markers.push({
        type: block.kind,
        label: truncateLabel(block.text),
        index,
      });
    }
  });
  result.missingImages.forEach((img, index) => {
    markers.push({
      type: "image",
      label: truncateLabel(img.alt || img.url),
      index,
    });
  });
  result.droppedLinks.forEach((link, index) => {
    markers.push({
      type: "link",
      label: truncateLabel(link.text || link.url),
      index,
    });
  });
  return markers;
}

export function computeSourceDiff(data: SourceDiffInput): SourceDiffResult {
  const source = extractHtmlContent(data.sourceHtml);

  const hasParsed =
    (Array.isArray(data.componentTree)
      ? data.componentTree.length > 0
      : Boolean(data.componentTree)) || Boolean(data.richText);
  const parsed = hasParsed
    ? extractTreeContent(data.componentTree ?? data.richText)
    : { blocks: [], images: [], links: [] };

  const hasSource = Boolean(data.sourceHtml && data.sourceHtml.trim().length);

  const { blocks, dropped, changed, added } = diffBlocks(
    source.blocks,
    parsed.blocks,
  );

  const sourceBlockByIndex = new Map<number, DiffBlock>();
  const parsedKindByIndex = new Map<number, BlockKind>();
  for (const b of blocks) {
    if (b.sourceIndex !== null) sourceBlockByIndex.set(b.sourceIndex, b);
    if (b.parsedIndex !== null) parsedKindByIndex.set(b.parsedIndex, b.kind);
  }

  const sourceBlocks: DiffBlockView[] = source.blocks.map((text, i) => {
    const db = sourceBlockByIndex.get(i);
    const kind = db?.kind ?? "equal";
    return {
      text,
      kind,
      words: kind === "changed" ? (db?.words ?? null) : null,
      parsedText: kind === "changed" ? db?.parsedText : undefined,
    };
  });
  const parsedBlocks: DiffBlockView[] = parsed.blocks.map((text, i) => ({
    text,
    kind: parsedKindByIndex.get(i) ?? "equal",
  }));

  const parsedImgSet = new Set(
    parsed.images.map((im) => normalizeUrl(im.url)).filter(Boolean),
  );
  const parsedLinkSet = new Set(
    parsed.links.map((l) => normalizeUrl(l.url)).filter(Boolean),
  );

  const missingImages = source.images.filter((im) => {
    const n = normalizeUrl(im.url);
    return n.length > 0 && !parsedImgSet.has(n);
  });
  const droppedLinks = source.links.filter((l) => {
    const n = normalizeUrl(l.url);
    return n.length > 0 && !parsedLinkSet.has(n);
  });

  const counts = {
    dropped,
    changed,
    added,
    missingImages: missingImages.length,
    droppedLinks: droppedLinks.length,
  };
  const total =
    counts.dropped + counts.changed + counts.missingImages + counts.droppedLinks;

  return {
    hasSource,
    hasParsed,
    sourceBlocks,
    parsedBlocks,
    missingImages,
    droppedLinks,
    counts,
    total,
  };
}
