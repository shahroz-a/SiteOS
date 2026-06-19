/**
 * Pure decision logic for auto-deactivating redirects whose targets are
 * confirmed dead.
 *
 * The migrated blog forwards old / renamed / retired URLs to a destination via
 * the static redirect stubs in `./redirects.ts`. If that destination is itself
 * gone, the redirect quietly sends readers and crawlers into a 404. This module
 * decides, from a single "reading" of a target plus the history persisted on the
 * redirect row, whether a redirect should be flipped to `isActive = false`.
 *
 * It is deliberately side-effect free (no DB, no network) so the policy — what
 * counts as dead, and how much corroboration is required before acting — can be
 * unit-tested in isolation. The runner (`scripts/src/redirect-health.ts`)
 * gathers the evidence (page-corpus lookups for on-blog targets, HTTP probes for
 * off-blog targets), feeds it here, and applies the verdict.
 *
 * Two confidence regimes, by target kind:
 *  - **on-blog** (`/blog/...`): deterministic. The target either resolves to a
 *    page we serve or it doesn't; a single reading is conclusive, so a missing
 *    target is deactivated immediately.
 *  - **off-blog** (everything else, resolved against the live Headout origin):
 *    a network reading and therefore fallible. A single 404/410 — or a timeout —
 *    must NOT retire a working redirect, so confirmed-dead readings have to
 *    accumulate across runs up to {@link OFF_BLOG_DEAD_THRESHOLD}; any healthy
 *    reading resets the counter.
 */

/**
 * Consecutive confirmed-dead readings an OFF-BLOG target must accumulate (across
 * separate runs of the job) before it is auto-deactivated. Two means a single
 * flaky reading is never enough — the second run has to agree.
 */
export const OFF_BLOG_DEAD_THRESHOLD = 2;

/**
 * HTTP statuses that mean a destination is permanently gone. Only these count as
 * "dead" — a 5xx, 403, 429 or a redirect-to-elsewhere is treated as alive/
 * inconclusive, never as grounds to retire a redirect.
 */
export const DEAD_HTTP_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/** Whether a redirect target points back onto the blog or off to Headout. */
export type TargetKind = "on-blog" | "off-blog";

/**
 * Classify a redirect `toPath` by where it points. On-blog targets stay
 * root-relative under `/blog/`; everything else resolves off-blog (a Headout
 * product/category page). Mirrors the on-blog test in `redirectTargetUrl`.
 */
export function targetKind(toPath: string): TargetKind {
  return toPath.startsWith("/blog/") ? "on-blog" : "off-blog";
}

/**
 * Normalise a path for trailing-slash / query / fragment-insensitive comparison
 * against the served page corpus: strips a `#fragment` and `?query`, then any
 * trailing slashes. The bare root collapses to `/`. Junk targets carrying
 * embedded URLs simply won't match any real page and so read as dead.
 */
export function normalizeTargetPath(path: string): string {
  const noHash = path.split("#")[0] ?? "";
  const noQuery = noHash.split("?")[0] ?? "";
  const trimmed = noQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Live/dead/inconclusive verdict from one reading of a target. */
export type Verdict = "alive" | "dead" | "unknown";

/**
 * A single reading of a redirect target.
 *  - on-blog: `exists` is whether a page is served at that path.
 *  - off-blog: `status` is the final HTTP status after following redirects, or
 *    `null` when the probe failed (timeout / DNS / connection error).
 */
export type TargetReading =
  | { kind: "on-blog"; exists: boolean }
  | { kind: "off-blog"; status: number | null };

/**
 * Reduce one reading to a verdict. An off-blog probe failure is `unknown`
 * (a blip, not evidence of death) and a non-dead status is `alive`.
 */
export function readingVerdict(reading: TargetReading): Verdict {
  if (reading.kind === "on-blog") return reading.exists ? "alive" : "dead";
  if (reading.status == null) return "unknown";
  return DEAD_HTTP_STATUSES.has(reading.status) ? "dead" : "alive";
}

/** Stable reason code recorded when a redirect is auto-deactivated. */
export type DeactivationReason = "on-blog-target-missing" | "off-blog-target-dead";

export interface HealthDecision {
  /** New consecutive-confirmed-dead counter to persist on the redirect row. */
  failures: number;
  /** Whether to flip `isActive` to false now. */
  deactivate: boolean;
  /** Reason code when deactivating; null otherwise. */
  reason: DeactivationReason | null;
}

/**
 * Decide what to do with a redirect given its target kind, the latest reading's
 * verdict, and the consecutive-dead counter persisted from prior runs.
 *
 * - `alive`   → reset the counter, keep the redirect.
 * - `unknown` → preserve the counter, take no action (off-blog network blip).
 * - `dead`    → increment the counter; deactivate immediately for on-blog
 *   (deterministic), or once the counter reaches `threshold` for off-blog.
 */
export function decideHealth(
  kind: TargetKind,
  verdict: Verdict,
  prevFailures: number,
  threshold: number = OFF_BLOG_DEAD_THRESHOLD,
): HealthDecision {
  if (verdict === "alive") return { failures: 0, deactivate: false, reason: null };
  if (verdict === "unknown") {
    return { failures: prevFailures, deactivate: false, reason: null };
  }
  // verdict === "dead"
  const failures = prevFailures + 1;
  if (kind === "on-blog") {
    return { failures, deactivate: true, reason: "on-blog-target-missing" };
  }
  const deactivate = failures >= threshold;
  return {
    failures,
    deactivate,
    reason: deactivate ? "off-blog-target-dead" : null,
  };
}
