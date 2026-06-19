/**
 * Auto-publish scheduled posts whose time has come.
 *
 * The CMS lets an editor put a post into the `scheduled` state with a future
 * `scheduledFor` time. Without a background job, nothing ever flips that post to
 * `published` once the time arrives — an editor must do it by hand, and the
 * content dashboard shows the post as "overdue by X" in the meantime. This job
 * closes that gap: it finds every `scheduled` post whose `scheduledFor` <= now,
 * transitions it to `published`, stamps `publishedAt` with the originally
 * scheduled time (falling back to now), and clears `scheduledFor` — all in a
 * single UPDATE so the run is atomic and idempotent (a second run finds nothing
 * left to publish).
 *
 * Every auto-publish is auditable: an `audit_logs` row (action
 * `article.publish.scheduled`, no human actor) records the before/after status
 * for the CMS audit trail, and a durable `crawl_logs` line is written so the
 * outcome survives in the prod DB even though a scheduled deployment's
 * filesystem is ephemeral. Both writes are best-effort and never fail the job.
 *
 * This mirrors the api-server's in-process 60s scheduler (which only runs while
 * the always-on server is up); running it as a Replit Scheduled Deployment makes
 * scheduling hands-off even if the server is asleep or the deployment is purely
 * static.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run publish:scheduled            # apply
 *   pnpm --filter @workspace/scripts run publish:scheduled -- --dry-run
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, lte, sql } from "drizzle-orm";
import { db, pool, pagesTable, auditLogsTable, crawlLogsTable } from "@workspace/db";

interface Options {
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Options {
  return { dryRun: argv.includes("--dry-run") };
}

export interface PublishedPost {
  id: string;
  slug: string;
  title: string;
  pathname: string;
  /** The time the post was scheduled for (its new publishedAt). */
  scheduledFor: string | null;
}

export interface PublishResult {
  /** Posts found due (and published, unless dry-run). */
  published: PublishedPost[];
  dryRun: boolean;
}

/**
 * Publish every scheduled post whose time has come. In dry-run mode it only
 * SELECTs the due posts; otherwise it UPDATEs them to `published` in one
 * statement and writes best-effort audit + crawl-log entries for each.
 */
export async function run(
  opts: Options,
  now: Date = new Date(),
): Promise<PublishResult> {
  if (opts.dryRun) {
    const due = await db
      .select({
        id: pagesTable.id,
        slug: pagesTable.slug,
        title: pagesTable.title,
        pathname: pagesTable.pathname,
        scheduledFor: pagesTable.scheduledFor,
      })
      .from(pagesTable)
      .where(
        and(
          eq(pagesTable.status, "scheduled"),
          lte(pagesTable.scheduledFor, now),
        ),
      );
    return {
      published: due.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        pathname: p.pathname,
        scheduledFor: p.scheduledFor ? p.scheduledFor.toISOString() : null,
      })),
      dryRun: true,
    };
  }

  // Atomic publish: flip status and stamp publishedAt with the originally
  // scheduled time (falling back to now) in one UPDATE, returning the rows so we
  // can audit exactly what changed. Safe to re-run — once published, a row no
  // longer matches the predicate.
  const rows = await db
    .update(pagesTable)
    .set({
      status: "published",
      publishedAt: sql`coalesce(${pagesTable.scheduledFor}, ${now})`,
      scheduledFor: null,
      modifiedAt: now,
    })
    .where(
      and(eq(pagesTable.status, "scheduled"), lte(pagesTable.scheduledFor, now)),
    )
    .returning({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      pathname: pagesTable.pathname,
      publishedAt: pagesTable.publishedAt,
    });

  const published: PublishedPost[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    pathname: r.pathname,
    scheduledFor: r.publishedAt ? r.publishedAt.toISOString() : null,
  }));

  for (const post of published) {
    // CMS audit trail row — no human actor, so the lifecycle change is still
    // visible to editors as a scheduled auto-publish.
    await db
      .insert(auditLogsTable)
      .values({
        action: "article.publish.scheduled",
        entityType: "post",
        entityId: post.id,
        before: { status: "scheduled" },
        after: { status: "published", publishedAt: post.scheduledFor },
        metadata: { source: "publish-scheduled-job", slug: post.slug },
      })
      .catch(() => {});

    // Durable crawl-log line — survives in the prod DB after the ephemeral
    // scheduled-deployment container is gone.
    await db
      .insert(crawlLogsTable)
      .values({
        url: post.pathname,
        level: "info",
        message: `Auto-published scheduled post ${post.slug} (${post.title})`,
        details: { ...post, action: "publish-scheduled" },
      })
      .catch(() => {});
  }

  return { published, dryRun: false };
}

export async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn("[publish-scheduled] DATABASE_URL is not set; nothing to do.");
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  try {
    const result = await run(opts);
    const tag = result.dryRun
      ? " (dry-run, no changes written)"
      : "";
    console.log(
      `[publish-scheduled] Published ${result.published.length} due scheduled post(s)${tag}.`,
    );
    // Echo each publish to stdout so a scheduled run is fully observable from
    // the deployment logs alone — the audit/crawl rows live in the DB.
    for (const p of result.published) {
      console.log(
        `[publish-scheduled] ${result.dryRun ? "would publish" : "published"} ` +
          `${p.slug} -> ${p.pathname} (scheduledFor=${p.scheduledFor ?? "n/a"})`,
      );
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((error) => {
    console.error("[publish-scheduled]", error);
    process.exit(1);
  });
}
