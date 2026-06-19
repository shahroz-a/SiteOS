/**
 * Redirect target health: two complementary, side-effect-free cores in one file.
 *
 * The migrated blog forwards old / renamed / retired URLs to a destination via
 * the static redirect stubs in `./redirects.ts`. A stub is only useful if the
 * place it forwards to still exists; over time on-blog targets can be
 * unpublished and off-blog targets (retired articles now pointing at a Headout
 * product/category page) can 404, leaving readers and crawlers forwarded into a
 * dead end. Two jobs act on that risk, and both keep their pure policy here so
 * it can be unit-tested without a DB or the network:
 *
 *  1. **Auto-deactivation** (`decideHealth` & friends, runner
 *     `scripts/src/redirect-health.ts`): from a single "reading" of a target
 *     plus the history persisted on the redirect row, decide whether to flip
 *     `isActive = false`. Two confidence regimes by target kind:
 *      - **on-blog** (`/blog/...`): deterministic. The target either resolves to
 *        a page we serve or it doesn't; a single reading is conclusive, so a
 *        missing target is deactivated immediately.
 *      - **off-blog** (resolved against the live Headout origin): a fallible
 *        network reading. A single 404/410 — or a timeout — must NOT retire a
 *        working redirect, so confirmed-dead readings have to accumulate across
 *        runs up to {@link OFF_BLOG_DEAD_THRESHOLD}; any healthy reading resets
 *        the counter.
 *
 *  2. **Verification digest** (`checkRedirectTargets` / `formatHealthDigest`,
 *     CLI `scripts/src/check-redirect-targets.ts`): probe every active
 *     redirect's target and format a human-readable digest (subject + body)
 *     ready for delivery over a chat webhook OR email, without modifying the DB.
 *      - **on-blog** (`/blog/...`): the static SPA's `/* -> /index.html` rewrite
 *        makes an HTTP probe of any `/blog/...` path return 200 regardless of
 *        whether real content exists — probing is meaningless. Instead verify
 *        the target against the set of published content the prerender emits.
 *      - **off-blog** (absolute URL): a real origin we can HTTP-probe; 2xx/3xx
 *        is healthy, 4xx/5xx or a network error is broken.
 */

import { redirectTargetUrl } from "./redirects";

// ---------------------------------------------------------------------------
// 1. Auto-deactivation policy (runner: scripts/src/redirect-health.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 2. Verification digest (CLI: scripts/src/check-redirect-targets.ts)
// ---------------------------------------------------------------------------

export type TargetScope = "on-blog" | "off-blog";

/** A single active redirect to evaluate. */
export interface RedirectInput {
  fromPath: string;
  toPath: string;
}

/** Outcome for one unique resolved target (shared across all old paths that
 * forward to it). */
export interface TargetResult {
  /** The resolved destination URL (root-relative for on-blog, absolute
   * otherwise) via {@link redirectTargetUrl}. */
  target: string;
  scope: TargetScope;
  /** Whether the target is reachable / exists. */
  ok: boolean;
  /** HTTP status for off-blog probes; `null` for on-blog or network errors. */
  status: number | null;
  /** Human-readable explanation of the outcome. */
  detail: string;
  /** Every old path that forwards to this target. */
  fromPaths: string[];
}

export interface HealthReport {
  /** Number of active redirects evaluated. */
  checkedRedirects: number;
  /** Number of unique resolved targets evaluated. */
  checkedTargets: number;
  /** Per-target outcomes. */
  results: TargetResult[];
  /** The subset of {@link results} that are broken. */
  broken: TargetResult[];
}

export interface CheckDeps {
  /** Returns whether an on-blog (`/blog/...`) target resolves to published
   * content. Pure/injected so the core stays DB-free. */
  onBlogExists: (target: string) => boolean | Promise<boolean>;
  /** HTTP-probes an absolute off-blog URL. `ok` should be true for 2xx/3xx. */
  probe: (url: string) => Promise<{ ok: boolean; status: number | null }>;
  /** Max concurrent target checks (default 8). */
  concurrency?: number;
}

/** Classify a resolved target by where it points. On-blog targets stay
 * root-relative (`/blog/...`); everything else has been made absolute. */
export function targetScope(target: string): TargetScope {
  return target.startsWith("/blog/") ? "on-blog" : "off-blog";
}

/** Total number of *redirects* (old paths) that forward to a broken target —
 * the operator-facing count (a single dead destination can strand many old
 * URLs). */
export function totalBroken(report: HealthReport): number {
  return report.broken.reduce((n, r) => n + r.fromPaths.length, 0);
}

/**
 * Evaluate the health of every active redirect's target. Targets are
 * de-duplicated (many old paths can forward to the same destination) so each
 * unique target is checked once, with bounded concurrency.
 */
export async function checkRedirectTargets(
  redirects: RedirectInput[],
  deps: CheckDeps,
): Promise<HealthReport> {
  const concurrency = Math.max(1, deps.concurrency ?? 8);

  // Group old paths by their resolved target so each destination is checked
  // exactly once. Sorted for deterministic output.
  const byTarget = new Map<string, string[]>();
  for (const r of redirects) {
    const target = redirectTargetUrl(r.toPath);
    const list = byTarget.get(target) ?? [];
    list.push(r.fromPath);
    byTarget.set(target, list);
  }
  const targets = [...byTarget.keys()].sort();
  const results: TargetResult[] = new Array(targets.length);

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      const target = targets[i];
      const fromPaths = (byTarget.get(target) ?? []).slice().sort();
      const scope = targetScope(target);
      let ok = false;
      let status: number | null = null;
      let detail = "";
      try {
        if (scope === "on-blog") {
          ok = await deps.onBlogExists(target);
          detail = ok
            ? "on-blog page exists in published content"
            : "on-blog page not found in published content";
        } else {
          const res = await deps.probe(target);
          ok = res.ok;
          status = res.status;
          detail = ok
            ? `reachable (HTTP ${status ?? "?"})`
            : status === null
              ? "unreachable (network error / no response)"
              : `broken (HTTP ${status})`;
        }
      } catch (err) {
        ok = false;
        detail = `check failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      results[i] = { target, scope, ok, status, detail, fromPaths };
    }
  };

  const lanes = Math.min(concurrency, targets.length) || 1;
  await Promise.all(Array.from({ length: lanes }, worker));

  const finalResults = results.filter(Boolean);
  return {
    checkedRedirects: redirects.length,
    checkedTargets: targets.length,
    results: finalResults,
    broken: finalResults.filter((r) => !r.ok),
  };
}

export interface HealthDigest {
  /** One-line summary suitable for an email subject. */
  subject: string;
  /** Multi-line plain-text body suitable for an email body or chat webhook. */
  text: string;
}

/**
 * Format a {@link HealthReport} into a delivery-ready digest. The same digest
 * feeds both the chat webhook (`{text}`) and the email body (`{subject,text}`),
 * so the two channels can never drift.
 */
export function formatHealthDigest(report: HealthReport): HealthDigest {
  const broken = totalBroken(report);
  if (broken === 0) {
    return {
      subject: "Redirect health: all targets OK",
      text:
        `All clear: ${report.checkedRedirects} active redirect(s) forward to a ` +
        `reachable target across ${report.checkedTargets} unique destination(s).`,
    };
  }

  const lines: string[] = [];
  lines.push(
    `Redirect health: ${broken} redirect(s) forward to a broken target ` +
      `(${report.broken.length} unique destination(s)).`,
  );
  lines.push("");
  for (const r of report.broken) {
    lines.push(`BROKEN [${r.scope}] ${r.target} - ${r.detail}`);
    for (const from of r.fromPaths) {
      lines.push(`    from: ${from}`);
    }
  }
  lines.push("");
  lines.push(
    `Checked ${report.checkedRedirects} active redirect(s) / ` +
      `${report.checkedTargets} unique target(s).`,
  );
  return {
    subject: `Redirect health: ${broken} broken target(s)`,
    text: lines.join("\n"),
  };
}

/**
 * Whether a digest should be delivered (to webhook and/or email). A clean run
 * is quiet by default to avoid notification fatigue; pass `notifyOnClean` to
 * deliver the all-clear digest too.
 */
export function shouldNotify(
  report: HealthReport,
  notifyOnClean: boolean,
): boolean {
  return totalBroken(report) > 0 || notifyOnClean;
}

/** Published content used to decide whether an on-blog target exists. */
export interface OnBlogContent {
  postSlugs: string[];
  categorySlugs: string[];
  authorSlugs: string[];
}

/**
 * Build the set of normalised on-blog paths the prerender would emit real
 * content for (no trailing slash). Mirrors the routes in `prerender-blog.ts`:
 * the index, the search shell, every published post, and every category /
 * author landing page.
 */
export function buildOnBlogPathSet(content: OnBlogContent): Set<string> {
  const set = new Set<string>();
  const add = (p: string): void => {
    set.add(p.replace(/\/+$/, ""));
  };
  add("/blog");
  add("/blog/search");
  for (const s of content.postSlugs) add(`/blog/${s}`);
  for (const s of content.categorySlugs) add(`/blog/category/${s}`);
  for (const s of content.authorSlugs) add(`/blog/author/${s}`);
  return set;
}

/**
 * Whether `target` (an on-blog `/blog/...` path, possibly with a query/hash or
 * trailing slash) is present in a path set from {@link buildOnBlogPathSet}.
 */
export function onBlogExistsIn(
  set: ReadonlySet<string>,
  target: string,
): boolean {
  const noQuery = target.split(/[?#]/)[0];
  return set.has(noQuery.replace(/\/+$/, ""));
}
