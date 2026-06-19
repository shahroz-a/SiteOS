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
    out.push({ op: "insert", text: b.join("") });
    return;
  }
  if (m === 0) {
    out.push({ op: "delete", text: a.join("") });
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
 * Produce an ordered list of equal/insert/delete segments turning `before`
 * into `after`, diffed at word granularity. Shared leading/trailing tokens are
 * emitted as `equal` context so localized edits read clearly.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
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

  if (start > 0) {
    segments.push({ op: "equal", text: a.slice(0, start).join("") });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length * midB.length > MAX_MATRIX) {
    if (midA.length) segments.push({ op: "delete", text: midA.join("") });
    if (midB.length) segments.push({ op: "insert", text: midB.join("") });
  } else {
    lcsSegments(midA, midB, segments);
  }

  if (endA < a.length) {
    segments.push({ op: "equal", text: a.slice(endA).join("") });
  }

  return mergeSegments(segments);
}
