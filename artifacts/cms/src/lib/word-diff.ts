export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

// Beyond this token-matrix size we skip the O(n*m) LCS and fall back to a
// coarse delete+insert of the differing middle (after trimming the shared
// prefix/suffix). This keeps a full rewrite of a very large article body from
// freezing the browser, while localized edits stay precise.
const MAX_MATRIX = 4_000_000;

/** Split into word and whitespace runs so output can be reassembled verbatim. */
function tokenize(value: string): string[] {
  return value.match(/\s+|\S+/g) ?? [];
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const last = out[out.length - 1];
    if (last && last.op === seg.op) {
      last.text += seg.text;
    } else {
      out.push({ op: seg.op, text: seg.text });
    }
  }
  return out;
}

/** Longest-common-subsequence diff over a small slice of tokens. */
function lcsSegments(a: string[], b: string[], out: DiffSegment[]): void {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return;
  if (n === 0) {
    // Push per token (not joined) so callers that inspect individual tokens
    // — e.g. the HTML diff distinguishing tags from text — keep working.
    for (const t of b) out.push({ op: "insert", text: t });
    return;
  }
  if (m === 0) {
    for (const t of a) out.push({ op: "delete", text: t });
    return;
  }

  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "delete", text: a[i] });
      i++;
    } else {
      out.push({ op: "insert", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ op: "delete", text: a[i] });
    i++;
  }
  while (j < m) {
    out.push({ op: "insert", text: b[j] });
    j++;
  }
}

/**
 * Diff two token arrays into a flat, per-token list of equal/insert/delete
 * segments (NOT merged). Shared leading/trailing tokens are emitted as `equal`
 * context so localized edits read clearly; a very large differing middle falls
 * back to a coarse delete+insert to keep the browser responsive.
 */
function diffTokens(a: string[], b: string[]): DiffSegment[] {
  const segments: DiffSegment[] = [];

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  for (let i = 0; i < start; i++) segments.push({ op: "equal", text: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_MATRIX) {
    for (const t of midA) segments.push({ op: "delete", text: t });
    for (const t of midB) segments.push({ op: "insert", text: t });
  } else {
    lcsSegments(midA, midB, segments);
  }

  for (let i = endA; i < a.length; i++) segments.push({ op: "equal", text: a[i] });

  return segments;
}

/**
 * Produce an ordered list of equal/insert/delete segments turning `before`
 * into `after`, diffed at word granularity. Shared leading/trailing tokens are
 * emitted as `equal` context so localized edits read clearly.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  return mergeSegments(diffTokens(tokenize(before), tokenize(after)));
}

/**
 * Split HTML into a token stream where each tag (`<p>`, `<a href=…>`, `<img …>`)
 * is one atomic token and the text between tags is split into word/whitespace
 * runs. This lets the diff treat markup as structure and only highlight the
 * text that actually changed.
 */
function tokenizeHtml(value: string): string[] {
  return value.match(/<[^>]+>|[^<\s]+|\s+/g) ?? [];
}

const HTML_TAG_RE = /^<[^>]+>$/;

/**
 * Produce a rendered-friendly diff of two HTML bodies. Tags from the shared and
 * the resulting ("after") structure pass through untouched so the output still
 * renders as a formatted article; only changed *text* is wrapped — insertions in
 * `<ins class="diff-ins">`, deletions in `<del class="diff-del">` — so the two
 * can be styled distinctly. Deleted tags are dropped (the surviving structure is
 * the "after" document) while their text is kept, struck-through, inline.
 *
 * The returned string is intended to be fed through the shared
 * `@workspace/blog-renderer` rendering pipeline, which sanitizes it before it is
 * injected into the DOM.
 */
export function diffHtml(before: string, after: string): string {
  const segments = diffTokens(tokenizeHtml(before), tokenizeHtml(after));

  let out = "";
  let pendingIns = "";
  let pendingDel = "";

  const flush = () => {
    if (pendingDel) {
      out += `<del class="diff-del">${pendingDel}</del>`;
      pendingDel = "";
    }
    if (pendingIns) {
      out += `<ins class="diff-ins">${pendingIns}</ins>`;
      pendingIns = "";
    }
  };

  for (const seg of segments) {
    const isTag = HTML_TAG_RE.test(seg.text);
    if (seg.op === "equal") {
      flush();
      out += seg.text;
    } else if (seg.op === "insert") {
      if (isTag) {
        flush();
        out += seg.text;
      } else {
        pendingIns += seg.text;
      }
    } else {
      // delete: drop removed tags, keep removed text struck-through inline.
      if (!isTag) pendingDel += seg.text;
    }
  }
  flush();

  return out;
}
