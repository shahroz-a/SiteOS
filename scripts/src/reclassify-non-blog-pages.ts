/**
 * One-time data remediation: keep non-blog commerce/main-site pages out of the
 * blog article feed.
 *
 * Some Headout pages whose URLs are NOT under `/blog/` (commerce/main-site pages
 * like `/museums-rome-sc-…`, `/london-theatre-tickets/…`) were stored with
 * `page_type='post'`, so the read API served them as blog articles. The crawler
 * classifier (`classifyUrl`) no longer mislabels these, but rows ingested before
 * that fix need correcting. This reclassifies any such row from `post` to `page`
 * (they are pages, just not editorial blog posts), which removes them from the
 * article feed served by `GET /posts`.
 *
 * Idempotent: re-running it is a no-op once no `post` rows with non-`/blog/`
 * canonical URLs remain.
 *
 * Run with: pnpm --filter @workspace/scripts run reclassify:non-blog
 */
import { db, pool, pagesTable } from "@workspace/db";
import { and, eq, notLike, sql } from "drizzle-orm";

async function main(): Promise<void> {
  const offenders = await db
    .select({ canonicalUrl: pagesTable.canonicalUrl })
    .from(pagesTable)
    .where(
      and(
        eq(pagesTable.pageType, "post"),
        notLike(pagesTable.canonicalUrl, "%/blog/%"),
      ),
    );

  if (offenders.length === 0) {
    console.log("No non-blog pages misclassified as 'post'. Nothing to do.");
    return;
  }

  console.log(`Reclassifying ${offenders.length} non-blog page(s) from 'post' to 'page':`);
  for (const row of offenders) console.log(`  - ${row.canonicalUrl}`);

  const updated = await db
    .update(pagesTable)
    .set({ pageType: sql`'page'::page_type` })
    .where(
      and(
        eq(pagesTable.pageType, "post"),
        notLike(pagesTable.canonicalUrl, "%/blog/%"),
      ),
    )
    .returning({ id: pagesTable.id });

  console.log(`Done. Reclassified ${updated.length} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
