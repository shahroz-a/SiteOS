import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  db,
  pagesTable,
  authorsTable,
  categoriesTable,
  tagsTable,
  imagesTable,
  internalLinksTable,
  externalLinksTable,
  seoTable,
  jsonldTable,
  redirectsTable,
  validationReportsTable,
  blocksTable,
} from "@workspace/db";
import { DEFAULT_CONFIG } from "./config";
import { classifyRedirect, type RedirectSkipReason } from "../prerender/redirects";
import { rescoreStoredValidation, type ValidationResult } from "./validate";
import type { PageType } from "./types";
import type { QueueStats } from "./queue";

/**
 * Build a held-back-queue entry for a draft article, re-deriving its verdict
 * from the latest stored validation row through the CURRENT validator (via
 * {@link rescoreStoredValidation}). Editors then see the live reason an article
 * is held back — the real current fail issues — never a stale/contradictory
 * verdict written by an older validator. A page with no validation row yet
 * carries null verdict fields (there is nothing to re-score).
 */
export function buildHeldBackEntry<
  T extends { pageType: PageType; url: string | null; title: string | null },
>(
  page: T,
  validation: { issues: unknown } | undefined,
): T & {
  validationStatus: ValidationResult["status"] | null;
  validationScore: number | null;
  issues: ValidationResult["issues"] | null;
} {
  if (!validation) {
    return { ...page, validationStatus: null, validationScore: null, issues: null };
  }
  const rescored = rescoreStoredValidation(validation.issues, page);
  return {
    ...page,
    validationStatus: rescored.status,
    validationScore: rescored.score,
    issues: rescored.issues,
  };
}

async function writeReport(dir: string, name: string, data: unknown): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

/**
 * Generate the full set of migration deliverable reports from the database
 * (the source of truth) and write them to the report directory.
 */
export async function generateReports(
  queueStats: QueueStats,
  reportDir = DEFAULT_CONFIG.reportDir,
): Promise<string[]> {
  const dir = path.resolve(process.cwd(), "..", reportDir);
  await mkdir(dir, { recursive: true }).catch(async () => {
    await mkdir(path.resolve(process.cwd(), reportDir), { recursive: true });
  });
  const outDir = dir;

  const written: string[] = [];

  // --- Crawl statistics ---
  const [pageCount] = await db.select({ c: sql<number>`count(*)::int` }).from(pagesTable);
  const byType = await db
    .select({ type: pagesTable.pageType, c: sql<number>`count(*)::int` })
    .from(pagesTable)
    .groupBy(pagesTable.pageType);
  const [authorCount] = await db.select({ c: sql<number>`count(*)::int` }).from(authorsTable);
  const [categoryCount] = await db.select({ c: sql<number>`count(*)::int` }).from(categoriesTable);
  const [tagCount] = await db.select({ c: sql<number>`count(*)::int` }).from(tagsTable);
  const [imageCount] = await db.select({ c: sql<number>`count(*)::int` }).from(imagesTable);

  const pagesByType = Object.fromEntries(byType.map((r) => [r.type, r.c])) as Record<
    string,
    number
  >;
  const webStories = pagesByType["web-story"] ?? 0;

  written.push(
    await writeReport(outDir, "crawl-statistics.json", {
      generatedAt: new Date().toISOString(),
      queue: queueStats,
      pages: pageCount?.c ?? 0,
      pagesByType,
      // Navigational/taxonomy page types broken out for at-a-glance verification.
      // Web stories are now a first-class page_type ("web-story"), read straight
      // from pagesByType rather than re-derived from URL patterns.
      pagesStoredByType: {
        post: pagesByType.post ?? 0,
        category: pagesByType.category ?? 0,
        author: pagesByType.author ?? 0,
        page: pagesByType.page ?? 0,
        webStory: webStories,
      },
      webStories,
      authors: authorCount?.c ?? 0,
      categories: categoryCount?.c ?? 0,
      tags: tagCount?.c ?? 0,
      images: imageCount?.c ?? 0,
    }),
  );

  // --- Validation report ---
  // Validation reports accumulate one row per (re)validation, so a page can have
  // several historical rows. Join to pages (dropping orphan rows for deleted
  // pages) and keep only the latest row per page so counts reflect each page's
  // CURRENT state rather than its full history.
  const validationRows = await db
    .select({
      pageId: validationReportsTable.pageId,
      status: validationReportsTable.status,
      score: validationReportsTable.score,
      issues: validationReportsTable.issues,
      pageType: pagesTable.pageType,
      url: pagesTable.canonicalUrl,
      title: pagesTable.title,
    })
    .from(validationReportsTable)
    .innerJoin(pagesTable, eq(validationReportsTable.pageId, pagesTable.id))
    .orderBy(desc(validationReportsTable.createdAt));
  const latestValidationByPage = new Map<string, (typeof validationRows)[number]>();
  for (const v of validationRows) {
    if (v.pageId && !latestValidationByPage.has(v.pageId)) latestValidationByPage.set(v.pageId, v);
  }
  const validations = [...latestValidationByPage.values()];
  // Trust the CURRENT validator, not the stored verdict. A page's latest row may
  // have been written by an older validator (e.g. one that wrongly failed
  // non-article pages). Re-scoring its captured tallies against the live rules
  // means a superseded/stale row can never surface as a failure or block launch
  // readiness on its own — no manual re-validate required.
  const currentStatusByPage = new Map<string, ValidationResult["status"]>();
  for (const v of validations) {
    if (!v.pageId) continue;
    currentStatusByPage.set(
      v.pageId,
      rescoreStoredValidation(v.issues, { pageType: v.pageType, url: v.url, title: v.title }).status,
    );
  }
  const currentStatus = (v: (typeof validations)[number]) =>
    (v.pageId ? currentStatusByPage.get(v.pageId) : undefined) ?? v.status;
  const byStatus = validations.reduce<Record<string, number>>((acc, v) => {
    const s = currentStatus(v);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const failures = validations.filter((v) => currentStatus(v) === "fail");
  written.push(
    await writeReport(outDir, "validation-report.json", {
      generatedAt: new Date().toISOString(),
      total: validations.length,
      byStatus,
      failures,
    }),
  );

  // --- Internal link graph ---
  const internal = await db
    .select({
      from: pagesTable.canonicalUrl,
      href: internalLinksTable.href,
      anchor: internalLinksTable.anchorText,
    })
    .from(internalLinksTable)
    .innerJoin(pagesTable, eq(internalLinksTable.pageId, pagesTable.id));
  written.push(
    await writeReport(outDir, "internal-link-graph.json", {
      generatedAt: new Date().toISOString(),
      edges: internal.length,
      graph: internal,
    }),
  );

  // --- External link graph ---
  const external = await db
    .select({
      from: pagesTable.canonicalUrl,
      href: externalLinksTable.href,
      domain: externalLinksTable.domain,
    })
    .from(externalLinksTable)
    .innerJoin(pagesTable, eq(externalLinksTable.pageId, pagesTable.id));
  const domains = external.reduce<Record<string, number>>((acc, e) => {
    if (e.domain) acc[e.domain] = (acc[e.domain] ?? 0) + 1;
    return acc;
  }, {});
  written.push(
    await writeReport(outDir, "external-link-graph.json", {
      generatedAt: new Date().toISOString(),
      edges: external.length,
      byDomain: domains,
      graph: external,
    }),
  );

  // --- SEO manifest ---
  const seo = await db
    .select({
      url: pagesTable.canonicalUrl,
      metaTitle: seoTable.metaTitle,
      metaDescription: seoTable.metaDescription,
      canonicalUrl: seoTable.canonicalUrl,
      robots: seoTable.robots,
      ogTitle: seoTable.ogTitle,
      ogImage: seoTable.ogImage,
    })
    .from(seoTable)
    .innerJoin(pagesTable, eq(seoTable.pageId, pagesTable.id));
  written.push(
    await writeReport(outDir, "seo-manifest.json", {
      generatedAt: new Date().toISOString(),
      total: seo.length,
      missingDescription: seo.filter((s) => !s.metaDescription).length,
      entries: seo,
    }),
  );

  // --- JSON-LD manifest ---
  const jsonld = await db
    .select({ url: pagesTable.canonicalUrl, type: jsonldTable.type })
    .from(jsonldTable)
    .innerJoin(pagesTable, eq(jsonldTable.pageId, pagesTable.id));
  const jsonldTypes = jsonld.reduce<Record<string, number>>((acc, j) => {
    const t = j.type ?? "unknown";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});
  written.push(
    await writeReport(outDir, "jsonld-manifest.json", {
      generatedAt: new Date().toISOString(),
      total: jsonld.length,
      byType: jsonldTypes,
      entries: jsonld,
    }),
  );

  // --- Image manifest ---
  const images = await db
    .select({
      pageUrl: pagesTable.canonicalUrl,
      url: imagesTable.url,
      alt: imagesTable.alt,
      caption: imagesTable.caption,
    })
    .from(imagesTable)
    .innerJoin(pagesTable, eq(imagesTable.pageId, pagesTable.id));
  written.push(
    await writeReport(outDir, "image-manifest.json", {
      generatedAt: new Date().toISOString(),
      total: images.length,
      missingAlt: images.filter((i) => !i.alt).length,
      entries: images,
    }),
  );

  // --- Redirect map ---
  const redirects = await db.select().from(redirectsTable);
  written.push(
    await writeReport(outDir, "redirect-map.json", {
      generatedAt: new Date().toISOString(),
      total: redirects.length,
      redirects,
    }),
  );

  // --- Skipped redirects (forwards-to-nowhere) ---
  // Every ACTIVE redirect whose old path the prerender silently can't serve a
  // forwarding stub for, grouped by reason. These rows quietly drop inbound
  // links: an operator uses this report to fix or deactivate the junk
  // `from_path` values (embedded URLs, query strings, map links, off-blog
  // sources, self-loops). The classification reuses `classifyRedirect`, the same
  // logic the prerender serves with, so it can never disagree with what is
  // actually written.
  const activeRedirects = redirects.filter((r) => r.isActive);
  const skippedEntries = activeRedirects
    .map((r) => ({
      id: r.id,
      fromPath: r.fromPath,
      toPath: r.toPath,
      reason: classifyRedirect(r.fromPath, r.toPath).reason,
    }))
    .filter(
      (r): r is typeof r & { reason: RedirectSkipReason } => r.reason !== null,
    );
  const skippedByReason = skippedEntries.reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1;
      return acc;
    },
    {},
  );
  written.push(
    await writeReport(outDir, "redirect-skipped.json", {
      generatedAt: new Date().toISOString(),
      totalActive: activeRedirects.length,
      served: activeRedirects.length - skippedEntries.length,
      skipped: skippedEntries.length,
      byReason: {
        "non-blog-source": skippedByReason["non-blog-source"] ?? 0,
        "malformed-segment": skippedByReason["malformed-segment"] ?? 0,
        "self-redirect": skippedByReason["self-redirect"] ?? 0,
      },
      entries: skippedEntries,
    }),
  );

  // --- Held-back articles (editor review queue) ---
  // Articles kept out of the public read API because content-fidelity
  // validation failed (pages.status="draft"). Editors use this queue to review
  // and republish them. Reuses pages + the latest validation_reports row per page.
  const draftPages = await db
    .select({
      id: pagesTable.id,
      slug: pagesTable.slug,
      title: pagesTable.title,
      url: pagesTable.canonicalUrl,
      pageType: pagesTable.pageType,
      crawledAt: pagesTable.crawledAt,
    })
    .from(pagesTable)
    // Only articles: editorial drafts of other page types are not part of the
    // "broken article" review queue.
    .where(and(eq(pagesTable.status, "draft"), eq(pagesTable.pageType, "post")))
    .orderBy(desc(pagesTable.crawledAt));
  // Re-score each draft's latest stored validation row through the CURRENT
  // validator so an editor sees the live reason an article is held back, not a
  // stale/contradictory verdict written by an older validator. The held-back
  // *set* is still driven by pages.status="draft" — only the displayed verdict
  // is refreshed.
  const heldBack = draftPages.map((p) => buildHeldBackEntry(p, latestValidationByPage.get(p.id)));
  written.push(
    await writeReport(outDir, "held-back-articles.json", {
      generatedAt: new Date().toISOString(),
      total: heldBack.length,
      articles: heldBack,
    }),
  );

  // --- Migration readiness report ---
  // Use the re-scored current verdict (see above) so a stale old-logic row can
  // no longer flip readiness to false on its own.
  const failedValidations = failures.length;
  const pagesMissingCanonical = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(pagesTable)
    .where(sql`${pagesTable.canonicalUrl} IS NULL`);
  written.push(
    await writeReport(outDir, "migration-readiness.json", {
      generatedAt: new Date().toISOString(),
      totalPages: pageCount?.c ?? 0,
      heldBackArticles: heldBack.length,
      validationFailures: failedValidations,
      pagesMissingCanonical: pagesMissingCanonical[0]?.c ?? 0,
      queuePending: queueStats.pending,
      queueFailed: queueStats.failed,
      ready:
        failedValidations === 0 &&
        queueStats.pending === 0 &&
        queueStats.failed === 0,
      blockingIssues: [
        ...(failedValidations > 0
          ? [`${failedValidations} pages failed content-fidelity validation`]
          : []),
        ...(queueStats.failed > 0 ? [`${queueStats.failed} URLs permanently failed to crawl`] : []),
      ],
    }),
  );

  // --- Payload mapping report ---
  const blockTypes = await db
    .select({ type: blocksTable.blockType, c: sql<number>`count(*)::int` })
    .from(blocksTable)
    .groupBy(blocksTable.blockType);
  written.push(
    await writeReport(outDir, "payload-mapping.json", payloadMapping(blockTypes, redirects.length)),
  );

  return written;
}

interface BlockTypeCount {
  type: string;
  c: number;
}

/**
 * Describe how stored data maps to Payload collections/block types and flag
 * any URL-preservation concern as a blocking issue.
 */
function payloadMapping(blockTypes: BlockTypeCount[], redirectCount: number): unknown {
  const collectionMap = {
    pages: { source: "pages + page_versions", payloadCollection: "pages", urlField: "slug" },
    authors: { source: "authors", payloadCollection: "users/authors" },
    categories: { source: "categories", payloadCollection: "categories" },
    tags: { source: "tags", payloadCollection: "tags" },
    media: { source: "images + videos + galleries", payloadCollection: "media (external URL)" },
    redirects: { source: "redirects", payloadCollection: "redirects plugin" },
    seo: { source: "seo + metadata + jsonld", payloadCollection: "SEO plugin fields" },
  };

  const blockTypeMapping: Record<string, string> = {
    heading: "Heading block",
    richText: "RichText (Lexical) block",
    list: "RichText list / List block",
    table: "Table block",
    quote: "Quote block",
    image: "MediaBlock (external URL)",
    gallery: "GalleryBlock",
    embed: "EmbedBlock / VideoBlock",
    accordion: "AccordionBlock",
    faqSection: "FAQBlock",
    cta: "CallToActionBlock",
    banner: "BannerBlock",
    newsletter: "NewsletterBlock",
    relatedArticles: "RelatedPostsBlock",
    section: "Group/Container block",
  };

  const unmapped = blockTypes.filter((b) => !blockTypeMapping[b.type]).map((b) => b.type);

  return {
    generatedAt: new Date().toISOString(),
    collections: collectionMap,
    blockTypes: blockTypes.map((b) => ({
      type: b.type,
      count: b.c,
      payloadBlock: blockTypeMapping[b.type] ?? "UNMAPPED — needs custom Payload block",
    })),
    richText: "Stored as structured JSON (Lexical-compatible) in pages.rich_text",
    urlPreservation: {
      strategy: "canonical_url is the public identifier; slug derived from URL; redirects preserved",
      redirectsPreserved: redirectCount,
    },
    blockingIssues: unmapped.length
      ? [`Block types without a Payload mapping: ${unmapped.join(", ")}`]
      : [],
  };
}
