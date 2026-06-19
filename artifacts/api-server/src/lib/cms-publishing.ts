import { randomBytes } from "node:crypto";
import { and, asc, eq, lte, ne, sql } from "drizzle-orm";
import {
  db,
  pagesTable,
  redirectsTable,
  previewTokensTable,
  auditLogsTable,
  crawlLogsTable,
} from "@workspace/db";
import type { Permission } from "@workspace/cms-auth";
import {
  serializeCmsPostDetail,
  canonicalUrlForSlug,
  pathnameForSlug,
  slugify,
  type Executor,
  type CmsPostDetail,
} from "./cms-content";

export type PageStatusValue = (typeof pagesTable.$inferSelect)["status"];

/**
 * The publish lifecycle state machine. A page may move to any status listed for
 * its current status; same-status (no-op) moves are intentionally excluded so a
 * pointless transition surfaces as an invalid request.
 */
export const TRANSITIONS: Record<PageStatusValue, PageStatusValue[]> = {
  draft: ["review", "scheduled", "published", "archived"],
  review: ["draft", "scheduled", "published", "archived"],
  scheduled: ["draft", "review", "published", "archived"],
  published: ["draft", "review", "archived"],
  archived: ["draft", "review", "scheduled", "published"],
};

/** Whether moving from `from` to `to` is a legal lifecycle transition. */
export function canTransition(
  from: PageStatusValue,
  to: PageStatusValue,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The permission required to perform a given transition. Anything that puts
 * content in front of (or pulls it back from) the public — publishing,
 * scheduling, or leaving the published state — needs `content.publish`. All
 * other editorial moves (submit-for-review, back-to-draft, archive a draft)
 * need only `content.edit`.
 */
export function requiredPermissionForTransition(
  from: PageStatusValue,
  to: PageStatusValue,
): Permission {
  if (to === "published" || to === "scheduled") return "content.publish";
  if (from === "published") return "content.publish";
  return "content.edit";
}

export type TransitionError =
  | "not-found"
  | "invalid-transition"
  | "schedule-required"
  | "schedule-in-past";

export interface TransitionResult {
  ok: boolean;
  error?: TransitionError;
  before?: PageStatusValue;
  detail?: CmsPostDetail;
}

/**
 * Apply a lifecycle transition to a page and return the updated detail. Pure
 * permission checks happen in the route; this enforces the state machine and the
 * scheduling invariants (a `scheduled` move needs a future date).
 */
export async function transitionPost(
  id: string,
  to: PageStatusValue,
  scheduledFor: Date | null,
  now: Date = new Date(),
  exec: Executor = db,
): Promise<TransitionResult> {
  const [page] = await exec
    .select({ id: pagesTable.id, status: pagesTable.status })
    .from(pagesTable)
    .where(eq(pagesTable.id, id))
    .limit(1);
  if (!page) return { ok: false, error: "not-found" };

  const from = page.status;
  if (!canTransition(from, to)) {
    return { ok: false, error: "invalid-transition", before: from };
  }

  if (to === "scheduled") {
    if (!scheduledFor) return { ok: false, error: "schedule-required", before: from };
    if (scheduledFor.getTime() <= now.getTime()) {
      return { ok: false, error: "schedule-in-past", before: from };
    }
  }

  const patch: Partial<typeof pagesTable.$inferInsert> = {
    status: to,
    modifiedAt: now,
  };
  if (to === "published") {
    patch.publishedAt = now;
    patch.scheduledFor = null;
  } else if (to === "scheduled") {
    patch.scheduledFor = scheduledFor;
  } else {
    // draft / review / archived clear any pending schedule.
    patch.scheduledFor = null;
  }

  await exec.update(pagesTable).set(patch).where(eq(pagesTable.id, id));
  const detail = await serializeCmsPostDetail(id, exec);
  return { ok: true, before: from, detail: detail ?? undefined };
}

/**
 * Publish every scheduled page whose time has come. Sets each to `published`,
 * stamping `publishedAt` with the originally-scheduled time (falling back to
 * now) and clearing `scheduledFor`. Returns the ids that were published so a
 * caller can invalidate caches / log. Safe to call repeatedly.
 *
 * Each auto-publish is recorded in the CMS audit trail (action
 * `article.publish.scheduled`, no human actor, entityType `page`) so editors can
 * see a history of what the scheduler published and when — mirroring the
 * standalone scheduled-deployment job (`scripts/src/publish-scheduled.ts`). A
 * durable `crawl_logs` line is also written. Both are best-effort and never fail
 * the publish itself.
 */
export async function publishDueScheduledPosts(
  now: Date = new Date(),
  exec: Executor = db,
): Promise<string[]> {
  const rows = await exec
    .update(pagesTable)
    .set({
      status: "published",
      publishedAt: sql`coalesce(${pagesTable.scheduledFor}, ${now})`,
      scheduledFor: null,
      modifiedAt: now,
    })
    .where(
      and(
        eq(pagesTable.status, "scheduled"),
        lte(pagesTable.scheduledFor, now),
      ),
    )
    .returning({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      pathname: pagesTable.pathname,
      publishedAt: pagesTable.publishedAt,
    });

  for (const row of rows) {
    const publishedAtIso = row.publishedAt
      ? row.publishedAt.toISOString()
      : null;
    // CMS audit trail row — no human actor, so the lifecycle change is still
    // visible to editors as a scheduled auto-publish.
    await exec
      .insert(auditLogsTable)
      .values({
        action: "article.publish.scheduled",
        entityType: "page",
        entityId: row.id,
        before: { status: "scheduled" },
        after: { status: "published", publishedAt: publishedAtIso },
        metadata: { source: "in-process-scheduler", slug: row.slug },
      })
      .catch(() => {});
    // Durable crawl-log line for parity with the standalone job.
    await exec
      .insert(crawlLogsTable)
      .values({
        url: row.pathname,
        level: "info",
        message: `Auto-published scheduled post ${row.slug} (${row.title})`,
        details: {
          id: row.id,
          slug: row.slug,
          title: row.title,
          pathname: row.pathname,
          publishedAt: publishedAtIso,
          action: "publish-scheduled",
        },
      })
      .catch(() => {});
  }

  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Preview tokens
// ---------------------------------------------------------------------------

export interface PreviewLink {
  token: string;
  expiresAt: Date;
}

/** Mint a high-entropy, expiring preview token for a page. */
export async function createPreviewToken(
  pageId: string,
  expiresInHours: number,
  createdById: string | null,
  now: Date = new Date(),
): Promise<PreviewLink | null> {
  const [page] = await db
    .select({ id: pagesTable.id })
    .from(pagesTable)
    .where(eq(pagesTable.id, pageId))
    .limit(1);
  if (!page) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
  await db.insert(previewTokensTable).values({
    token,
    pageId,
    createdById,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolve a preview token to its page id, enforcing that the token exists, is
 * not revoked, and has not expired. Returns null otherwise.
 */
export async function resolvePreviewToken(
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const [row] = await db
    .select({
      pageId: previewTokensTable.pageId,
      expiresAt: previewTokensTable.expiresAt,
      revokedAt: previewTokensTable.revokedAt,
    })
    .from(previewTokensTable)
    .where(eq(previewTokensTable.token, token))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return row.pageId;
}

// ---------------------------------------------------------------------------
// URL management & redirects
// ---------------------------------------------------------------------------

export type UrlChangeError = "not-found" | "empty-slug" | "slug-taken";

export interface UrlChangeResult {
  ok: boolean;
  error?: UrlChangeError;
  before?: { slug: string; pathname: string };
  detail?: CmsPostDetail;
}

/**
 * Change a page's slug (and the canonical/pathname derived from it). When the
 * pathname actually changes and `createRedirect` is set, the OLD pathname is
 * preserved as an active 301 → new pathname so existing inbound links keep
 * working. Any stale redirect whose source equals the NEW pathname is removed to
 * avoid a self-referential loop (e.g. reusing a previously-redirected path).
 */
export async function changePostUrl(
  id: string,
  desiredSlug: string,
  createRedirect: boolean,
  exec: Executor = db,
): Promise<UrlChangeResult> {
  const slug = slugify(desiredSlug);
  if (!slug) return { ok: false, error: "empty-slug" };

  const newCanonical = canonicalUrlForSlug(slug);
  const newPathname = pathnameForSlug(slug);

  const result = await exec.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Executor;
    const [page] = await tx
      .select({
        id: pagesTable.id,
        slug: pagesTable.slug,
        pathname: pagesTable.pathname,
      })
      .from(pagesTable)
      .where(eq(pagesTable.id, id))
      .limit(1);
    if (!page) return { ok: false as const, error: "not-found" as const };

    const before = { slug: page.slug, pathname: page.pathname };
    if (page.slug === slug) {
      // No-op rename; nothing to change or redirect.
      return { ok: true as const, before };
    }

    // The canonical URL is the only UNIQUE column; reject collisions.
    const [clash] = await tx
      .select({ id: pagesTable.id })
      .from(pagesTable)
      .where(
        and(
          eq(pagesTable.canonicalUrl, newCanonical),
          ne(pagesTable.id, id),
        ),
      )
      .limit(1);
    if (clash) return { ok: false as const, error: "slug-taken" as const };

    await tx
      .update(pagesTable)
      .set({
        slug,
        canonicalUrl: newCanonical,
        pathname: newPathname,
        modifiedAt: new Date(),
      })
      .where(eq(pagesTable.id, id));

    if (createRedirect && before.pathname !== newPathname) {
      // Drop any redirect that would now point away from the new live path.
      await tx
        .delete(redirectsTable)
        .where(eq(redirectsTable.fromPath, newPathname));
      // Preserve the old path as a 301 to the new one.
      await tx
        .insert(redirectsTable)
        .values({
          fromPath: before.pathname,
          toPath: newPathname,
          statusCode: 301,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: redirectsTable.fromPath,
          set: { toPath: newPathname, statusCode: 301, isActive: true },
        });
    }

    return { ok: true as const, before };
  });

  if (!result.ok) return result;
  const detail = await serializeCmsPostDetail(id, exec);
  return { ok: true, before: result.before, detail: detail ?? undefined };
}

export interface RedirectResolution {
  found: boolean;
  toPath: string | null;
  statusCode: number | null;
}

/** Resolve a (possibly old) path to its active redirect target, if any. */
export async function resolveRedirect(
  path: string,
  exec: Executor = db,
): Promise<RedirectResolution> {
  const [row] = await exec
    .select({
      toPath: redirectsTable.toPath,
      statusCode: redirectsTable.statusCode,
    })
    .from(redirectsTable)
    .where(
      and(eq(redirectsTable.fromPath, path), eq(redirectsTable.isActive, true)),
    )
    .limit(1);
  if (!row) return { found: false, toPath: null, statusCode: null };
  return { found: true, toPath: row.toPath, statusCode: row.statusCode };
}
