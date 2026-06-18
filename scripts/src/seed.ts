import { randomUUID } from "node:crypto";
import {
  db,
  pool,
  authorsTable,
  categoriesTable,
  tagsTable,
  pagesTable,
  pageVersionsTable,
  pageCategoriesTable,
  pageTagsTable,
  blocksTable,
  componentTreeTable,
  imagesTable,
  faqTable,
  breadcrumbsTable,
  jsonldTable,
  seoTable,
  metadataTable,
  internalLinksTable,
  externalLinksTable,
  redirectsTable,
  type InsertPage,
  type InsertBlock,
  type InsertImage,
  type InsertFaq,
  type InsertBreadcrumb,
  type InsertSeo,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SITE = "https://www.headout.com";

function uuid(): string {
  return randomUUID();
}

type BlockNode = {
  blockType: string;
  text?: string;
  data?: unknown;
  anchorId?: string;
  children?: BlockNode[];
};

/** Flatten a nested block tree into rows + return the same tree as JSON. */
function flattenBlocks(pageId: string, nodes: BlockNode[]): InsertBlock[] {
  const rows: InsertBlock[] = [];
  const walk = (
    list: BlockNode[],
    parentId: string | null,
    depth: number,
  ): void => {
    list.forEach((node, index) => {
      const id = uuid();
      rows.push({
        id,
        pageId,
        parentId,
        blockType: node.blockType,
        position: index,
        depth,
        anchorId: node.anchorId ?? null,
        data: node.data ?? null,
        text: node.text ?? null,
      } as InsertBlock & { id: string });
      if (node.children?.length) walk(node.children, id, depth + 1);
    });
  };
  walk(nodes, null, 0);
  return rows;
}

// ---------------------------------------------------------------------------
// Fixture definitions
// ---------------------------------------------------------------------------

const authors = [
  {
    id: uuid(),
    name: "Aiyana Rey",
    slug: "aiyana-rey",
    bio: "Aiyana is a family-travel writer who has spent a decade chasing the best holiday escapes across North America.",
    avatarUrl:
      "https://cdn-imgix.headout.com/media/images/authors/aiyana-rey.jpg",
    role: "Senior Travel Writer",
    email: "aiyana@example.com",
    originalUrl: `${SITE}/blog/author/aiyana-rey/`,
    social: { twitter: "@aiyanarey", instagram: "aiyana.travels" } as Record<
      string,
      string
    >,
  },
  {
    id: uuid(),
    name: "Marcus Vaughn",
    slug: "marcus-vaughn",
    bio: "Marcus covers city breaks, food trails and weekend getaways for time-strapped families.",
    avatarUrl:
      "https://cdn-imgix.headout.com/media/images/authors/marcus-vaughn.jpg",
    role: "Travel Editor",
    email: "marcus@example.com",
    originalUrl: `${SITE}/blog/author/marcus-vaughn/`,
    social: { twitter: "@marcusvaughn" } as Record<string, string>,
  },
  {
    id: uuid(),
    name: "Priya Nair",
    slug: "priya-nair",
    bio: "Priya writes about outdoor adventures, national parks and slow travel with kids.",
    avatarUrl:
      "https://cdn-imgix.headout.com/media/images/authors/priya-nair.jpg",
    role: "Contributing Writer",
    email: "priya@example.com",
    originalUrl: `${SITE}/blog/author/priya-nair/`,
    social: { instagram: "priya.outdoors" } as Record<string, string>,
  },
];

const categories = [
  {
    id: uuid(),
    name: "Family Travel",
    slug: "family-travel",
    description: "Trip ideas, guides and tips for travelling with the whole family.",
    parentId: null as string | null,
    path: "/blog/family-travel/",
    originalUrl: `${SITE}/blog/family-travel/`,
  },
  {
    id: uuid(),
    name: "Holidays",
    slug: "holidays",
    description: "Make the most of every holiday season with curated travel ideas.",
    parentId: null as string | null,
    path: "/blog/holidays/",
    originalUrl: `${SITE}/blog/holidays/`,
  },
  {
    id: uuid(),
    name: "Destinations",
    slug: "destinations",
    description: "City guides and destination deep-dives from around the world.",
    parentId: null as string | null,
    path: "/blog/destinations/",
    originalUrl: `${SITE}/blog/destinations/`,
  },
  {
    id: uuid(),
    name: "Travel Tips",
    slug: "travel-tips",
    description: "Practical advice to plan smarter, cheaper and smoother trips.",
    parentId: null as string | null,
    path: "/blog/travel-tips/",
    originalUrl: `${SITE}/blog/travel-tips/`,
  },
];

const tags = [
  { id: uuid(), name: "Thanksgiving", slug: "thanksgiving", description: null, originalUrl: `${SITE}/blog/tag/thanksgiving/` },
  { id: uuid(), name: "Kids", slug: "kids", description: null, originalUrl: `${SITE}/blog/tag/kids/` },
  { id: uuid(), name: "Road Trips", slug: "road-trips", description: null, originalUrl: `${SITE}/blog/tag/road-trips/` },
  { id: uuid(), name: "City Breaks", slug: "city-breaks", description: null, originalUrl: `${SITE}/blog/tag/city-breaks/` },
  { id: uuid(), name: "National Parks", slug: "national-parks", description: null, originalUrl: `${SITE}/blog/tag/national-parks/` },
  { id: uuid(), name: "Budget", slug: "budget", description: null, originalUrl: `${SITE}/blog/tag/budget/` },
  { id: uuid(), name: "Winter", slug: "winter", description: null, originalUrl: `${SITE}/blog/tag/winter/` },
];

const tagBySlug = Object.fromEntries(tags.map((t) => [t.slug, t.id]));
const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

type PostFixture = {
  page: InsertPage & { id: string };
  authorSlug: string;
  categorySlugs: string[];
  tagSlugs: string[];
  blocks?: BlockNode[];
  componentTree?: unknown;
  images?: Array<Omit<InsertImage, "pageId">>;
  faq?: Array<Omit<InsertFaq, "pageId">>;
  breadcrumbs?: Array<Omit<InsertBreadcrumb, "pageId">>;
  seo?: Omit<InsertSeo, "pageId">;
  jsonld?: Array<{ type: string; data: unknown }>;
  internalLinks?: Array<{ href: string; anchorText: string; position: number }>;
  externalLinks?: Array<{ href: string; anchorText: string; domain: string; position: number }>;
};

function makePost(opts: {
  title: string;
  slug: string;
  excerpt: string;
  subtitle?: string;
  featuredImageUrl: string;
  featuredImageAlt: string;
  publishedAt: string;
  authorSlug: string;
  categorySlugs: string[];
  tagSlugs: string[];
  readingTimeMinutes: number;
  wordCount: number;
}): PostFixture {
  const id = uuid();
  const pathname = `/blog/${opts.slug}/`;
  const canonicalUrl = `${SITE}${pathname}`;
  const cleanedHtml = `<h1>${opts.title}</h1><p>${opts.excerpt}</p>`;
  return {
    page: {
      id,
      slug: opts.slug,
      title: opts.title,
      subtitle: opts.subtitle ?? null,
      excerpt: opts.excerpt,
      pageType: "post",
      status: "published",
      language: "en",
      originalUrl: canonicalUrl,
      canonicalUrl,
      pathname,
      parentPath: "/blog/",
      permalink: canonicalUrl,
      trailingSlash: true,
      canonicalTag: canonicalUrl,
      hreflang: [{ lang: "en", href: canonicalUrl }],
      redirectTarget: null,
      httpStatus: 200,
      sitemapSource: `${SITE}/blog/sitemap.xml`,
      sitemapLastmod: new Date(opts.publishedAt),
      crawledAt: new Date(),
      authorId: authors.find((a) => a.slug === opts.authorSlug)!.id,
      primaryCategoryId: catBySlug[opts.categorySlugs[0]!]!,
      featuredImageUrl: opts.featuredImageUrl,
      featuredImageAlt: opts.featuredImageAlt,
      originalHtml: `<article>${cleanedHtml}</article>`,
      cleanedHtml,
      richText: {
        root: {
          type: "root",
          children: [
            { type: "heading", tag: "h1", children: [{ type: "text", text: opts.title }] },
            { type: "paragraph", children: [{ type: "text", text: opts.excerpt }] },
          ],
        },
      },
      componentTree: null,
      readingTimeMinutes: opts.readingTimeMinutes,
      wordCount: opts.wordCount,
      publishedAt: new Date(opts.publishedAt),
      modifiedAt: new Date(opts.publishedAt),
    },
    authorSlug: opts.authorSlug,
    categorySlugs: opts.categorySlugs,
    tagSlugs: opts.tagSlugs,
    breadcrumbs: [
      { position: 0, label: "Home", url: `${SITE}/` },
      { position: 1, label: "Blog", url: `${SITE}/blog/` },
      { position: 2, label: opts.title, url: canonicalUrl },
    ],
    seo: {
      metaTitle: `${opts.title} | Headout Blog`,
      metaDescription: opts.excerpt,
      canonicalUrl,
      robots: "index,follow",
      focusKeyword: opts.tagSlugs[0] ?? null,
      keywords: opts.tagSlugs,
      ogTitle: opts.title,
      ogDescription: opts.excerpt,
      ogImage: opts.featuredImageUrl,
      ogType: "article",
      twitterCard: "summary_large_image",
      twitterTitle: opts.title,
      twitterDescription: opts.excerpt,
      twitterImage: opts.featuredImageUrl,
    },
  };
}

// The flagship Thanksgiving post (rich content matching the article's shape).
const thanksgivingTree: BlockNode[] = [
  { blockType: "heading", text: "Thanksgiving Vacation Ideas for Families", anchorId: "intro" },
  {
    blockType: "paragraph",
    text: "Thanksgiving is the perfect excuse to swap the kitchen for a getaway the whole family will remember. From cosy mountain towns to sunny coastal escapes, here are our favourite family-friendly destinations for the long weekend.",
  },
  {
    blockType: "section",
    anchorId: "new-york-city",
    data: { heading: "1. New York City, New York" },
    children: [
      {
        blockType: "paragraph",
        text: "Catch the Macy's Thanksgiving Day Parade, go ice skating, and watch the city transform for the holidays.",
      },
      {
        blockType: "list",
        data: {
          title: "Where to eat",
          ordered: false,
          items: ["Gramercy Tavern", "Buvette", "Friedman's"],
        },
      },
      {
        blockType: "list",
        data: {
          title: "Things to do",
          ordered: false,
          items: [
            "Macy's Thanksgiving Day Parade",
            "Central Park",
            "The Edge observation deck",
          ],
        },
      },
    ],
  },
  {
    blockType: "section",
    anchorId: "orlando",
    data: { heading: "2. Orlando, Florida" },
    children: [
      {
        blockType: "paragraph",
        text: "Skip the cold and head to the theme-park capital of the world for sunshine and rollercoasters.",
      },
      {
        blockType: "list",
        data: {
          title: "Things to do",
          ordered: false,
          items: ["Walt Disney World", "Universal Studios", "ICON Park"],
        },
      },
    ],
  },
];

const thanksgiving = makePost({
  title: "Thanksgiving Vacation Ideas for Families",
  slug: "thanksgiving-vacation-ideas-for-families",
  subtitle: "12 family-friendly destinations for the long weekend",
  excerpt:
    "Trade the kitchen for an adventure. These family-friendly destinations make Thanksgiving a holiday everyone will look forward to.",
  featuredImageUrl:
    "https://cdn-imgix.headout.com/media/images/thanksgiving-family-hero.jpg",
  featuredImageAlt: "Family walking through an autumn park during Thanksgiving",
  publishedAt: "2025-10-28T09:00:00.000Z",
  authorSlug: "aiyana-rey",
  categorySlugs: ["family-travel", "holidays"],
  tagSlugs: ["thanksgiving", "kids", "winter"],
  readingTimeMinutes: 14,
  wordCount: 2800,
});
thanksgiving.blocks = thanksgivingTree;
thanksgiving.componentTree = {
  type: "root",
  schemaVersion: "1",
  children: thanksgivingTree,
};
thanksgiving.page.componentTree =
  thanksgiving.componentTree as InsertPage["componentTree"];
thanksgiving.images = [
  {
    galleryId: null,
    originalUrl:
      "https://cdn-imgix.headout.com/media/images/thanksgiving-family-hero.jpg",
    url: "https://cdn-imgix.headout.com/media/images/thanksgiving-family-hero.jpg",
    storageKey: null,
    alt: "Family walking through an autumn park during Thanksgiving",
    title: "Thanksgiving family hero",
    caption: "Autumn strolls are a Thanksgiving tradition.",
    credit: "Headout",
    width: 1600,
    height: 900,
    mimeType: "image/jpeg",
    fileSize: null,
    role: "featured",
    position: 0,
  },
  {
    galleryId: null,
    originalUrl:
      "https://cdn-imgix.headout.com/media/images/nyc-thanksgiving-parade.jpg",
    url: "https://cdn-imgix.headout.com/media/images/nyc-thanksgiving-parade.jpg",
    storageKey: null,
    alt: "Macy's Thanksgiving Day Parade balloons over New York City",
    title: "NYC parade",
    caption: "The Macy's parade is a New York institution.",
    credit: "Headout",
    width: 1600,
    height: 1067,
    mimeType: "image/jpeg",
    fileSize: null,
    role: "inline",
    position: 1,
  },
];
thanksgiving.faq = [
  {
    question: "Where should families travel for Thanksgiving?",
    answer:
      "Great options include New York City for the parade, Orlando for theme parks, and national parks for the outdoors.",
    answerRichText: null,
    position: 0,
  },
  {
    question: "When should I book Thanksgiving travel?",
    answer:
      "Book flights at least 6-8 weeks ahead, as Thanksgiving is one of the busiest travel weeks of the year.",
    answerRichText: null,
    position: 1,
  },
  {
    question: "Is Thanksgiving a good time for a road trip?",
    answer:
      "Yes, but expect heavy traffic on the Wednesday before and the Sunday after. Travel early to beat the rush.",
    answerRichText: null,
    position: 2,
  },
];
thanksgiving.jsonld = [
  {
    type: "Article",
    data: {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Thanksgiving Vacation Ideas for Families",
      author: { "@type": "Person", name: "Aiyana Rey" },
      datePublished: "2025-10-28",
    },
  },
  {
    type: "FAQPage",
    data: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Where should families travel for Thanksgiving?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "New York City, Orlando, and national parks are all great choices.",
          },
        },
      ],
    },
  },
];
thanksgiving.internalLinks = [
  {
    href: `${SITE}/blog/best-christmas-markets-usa/`,
    anchorText: "best Christmas markets in the USA",
    position: 0,
  },
  {
    href: `${SITE}/blog/new-york-city-family-guide/`,
    anchorText: "New York City family guide",
    position: 1,
  },
];
thanksgiving.externalLinks = [
  {
    href: "https://www.nps.gov/",
    anchorText: "National Park Service",
    domain: "nps.gov",
    position: 0,
  },
];

// Additional representative posts (lighter content).
const others: PostFixture[] = [
  makePost({
    title: "New York City Family Guide",
    slug: "new-york-city-family-guide",
    excerpt:
      "Everything you need to plan the perfect family trip to the Big Apple, from museums to Broadway.",
    featuredImageUrl: "https://cdn-imgix.headout.com/media/images/nyc-family.jpg",
    featuredImageAlt: "Family in Times Square, New York City",
    publishedAt: "2025-09-15T10:00:00.000Z",
    authorSlug: "marcus-vaughn",
    categorySlugs: ["destinations", "family-travel"],
    tagSlugs: ["city-breaks", "kids"],
    readingTimeMinutes: 11,
    wordCount: 2100,
  }),
  makePost({
    title: "Best Christmas Markets in the USA",
    slug: "best-christmas-markets-usa",
    excerpt:
      "Mulled wine, twinkling lights and handmade gifts: the most magical Christmas markets across America.",
    featuredImageUrl:
      "https://cdn-imgix.headout.com/media/images/christmas-markets.jpg",
    featuredImageAlt: "Festive Christmas market stalls at night",
    publishedAt: "2025-11-05T08:30:00.000Z",
    authorSlug: "aiyana-rey",
    categorySlugs: ["holidays", "destinations"],
    tagSlugs: ["winter", "city-breaks"],
    readingTimeMinutes: 9,
    wordCount: 1700,
  }),
  makePost({
    title: "10 Best National Parks for Families",
    slug: "best-national-parks-for-families",
    excerpt:
      "From geysers to giant sequoias, these national parks are made for family adventures.",
    featuredImageUrl:
      "https://cdn-imgix.headout.com/media/images/national-parks.jpg",
    featuredImageAlt: "Family hiking in a national park",
    publishedAt: "2025-06-20T07:00:00.000Z",
    authorSlug: "priya-nair",
    categorySlugs: ["destinations", "family-travel"],
    tagSlugs: ["national-parks", "kids", "road-trips"],
    readingTimeMinutes: 13,
    wordCount: 2500,
  }),
  makePost({
    title: "The Ultimate Family Road Trip Packing List",
    slug: "family-road-trip-packing-list",
    excerpt:
      "Never forget the essentials again with our printable, kid-tested road trip packing checklist.",
    featuredImageUrl:
      "https://cdn-imgix.headout.com/media/images/road-trip-packing.jpg",
    featuredImageAlt: "Car boot packed for a family road trip",
    publishedAt: "2025-05-02T12:00:00.000Z",
    authorSlug: "marcus-vaughn",
    categorySlugs: ["travel-tips"],
    tagSlugs: ["road-trips", "kids", "budget"],
    readingTimeMinutes: 7,
    wordCount: 1400,
  }),
  makePost({
    title: "How to Travel with Kids on a Budget",
    slug: "travel-with-kids-on-a-budget",
    excerpt:
      "Smart strategies to cut costs without cutting the fun on your next family holiday.",
    featuredImageUrl:
      "https://cdn-imgix.headout.com/media/images/budget-family-travel.jpg",
    featuredImageAlt: "Parents and children at an airport",
    publishedAt: "2025-04-18T09:30:00.000Z",
    authorSlug: "priya-nair",
    categorySlugs: ["travel-tips", "family-travel"],
    tagSlugs: ["budget", "kids"],
    readingTimeMinutes: 8,
    wordCount: 1600,
  }),
  makePost({
    title: "A Weekend in San Francisco with Kids",
    slug: "weekend-in-san-francisco-with-kids",
    excerpt:
      "Cable cars, sea lions and science museums: a packed two-day itinerary for families.",
    featuredImageUrl:
      "https://cdn-imgix.headout.com/media/images/san-francisco-family.jpg",
    featuredImageAlt: "Golden Gate Bridge on a sunny day",
    publishedAt: "2025-08-09T11:15:00.000Z",
    authorSlug: "marcus-vaughn",
    categorySlugs: ["destinations"],
    tagSlugs: ["city-breaks", "kids"],
    readingTimeMinutes: 10,
    wordCount: 1900,
  }),
];

const allPosts: PostFixture[] = [thanksgiving, ...others];

const redirects = [
  {
    id: uuid(),
    fromPath: "/blog/thanksgiving-ideas/",
    toPath: "/blog/thanksgiving-vacation-ideas-for-families/",
    statusCode: 301,
    isActive: true,
  },
  {
    id: uuid(),
    fromPath: "/blog/nyc-family/",
    toPath: "/blog/new-york-city-family-guide/",
    statusCode: 301,
    isActive: true,
  },
];

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

async function clear(): Promise<void> {
  // Delete in FK-safe order (children first, then pages, then taxonomy).
  await db.delete(internalLinksTable);
  await db.delete(externalLinksTable);
  await db.delete(jsonldTable);
  await db.delete(breadcrumbsTable);
  await db.delete(faqTable);
  await db.delete(imagesTable);
  await db.delete(blocksTable);
  await db.delete(componentTreeTable);
  await db.delete(metadataTable);
  await db.delete(seoTable);
  await db.delete(pageVersionsTable);
  await db.delete(pageTagsTable);
  await db.delete(pageCategoriesTable);
  await db.delete(redirectsTable);
  await db.delete(pagesTable);
  await db.delete(tagsTable);
  await db.delete(categoriesTable);
  await db.delete(authorsTable);
}

async function seed(): Promise<void> {
  console.log("Clearing existing data...");
  await clear();

  console.log("Inserting authors, categories, tags...");
  await db.insert(authorsTable).values(authors);
  await db.insert(categoriesTable).values(categories);
  await db.insert(tagsTable).values(tags);

  console.log(`Inserting ${allPosts.length} posts and related content...`);
  for (const post of allPosts) {
    await db.insert(pagesTable).values(post.page);

    // Version snapshot
    await db.insert(pageVersionsTable).values({
      pageId: post.page.id,
      versionNumber: 1,
      snapshot: post.page as unknown,
      originalHtml: post.page.originalHtml ?? null,
      contentHash: null,
      changeSummary: "Initial seed import",
      crawledAt: new Date(),
    });

    // Category / tag joins
    await db.insert(pageCategoriesTable).values(
      post.categorySlugs.map((slug) => ({
        pageId: post.page.id,
        categoryId: catBySlug[slug]!,
      })),
    );
    await db.insert(pageTagsTable).values(
      post.tagSlugs.map((slug) => ({
        pageId: post.page.id,
        tagId: tagBySlug[slug]!,
      })),
    );

    // SEO + metadata
    if (post.seo) {
      await db.insert(seoTable).values({ pageId: post.page.id, ...post.seo });
    }
    await db.insert(metadataTable).values({
      pageId: post.page.id,
      metaTags: [
        { name: "description", content: post.page.excerpt ?? "" },
        { property: "og:title", content: post.page.title },
      ],
      httpHeaders: { "content-type": "text/html; charset=utf-8" },
      openGraph: { "og:type": "article", "og:title": post.page.title },
      twitter: { "twitter:card": "summary_large_image" },
      custom: null,
    });

    // Breadcrumbs
    if (post.breadcrumbs?.length) {
      await db.insert(breadcrumbsTable).values(
        post.breadcrumbs.map((b) => ({ pageId: post.page.id, ...b })),
      );
    }

    // Blocks + component tree
    if (post.blocks?.length) {
      await db.insert(blocksTable).values(flattenBlocks(post.page.id, post.blocks));
    }
    if (post.componentTree) {
      await db.insert(componentTreeTable).values({
        pageId: post.page.id,
        tree: post.componentTree,
        schemaVersion: "1",
      });
    }

    // Images
    if (post.images?.length) {
      await db.insert(imagesTable).values(
        post.images.map((img) => ({ pageId: post.page.id, ...img })),
      );
    } else if (post.page.featuredImageUrl) {
      await db.insert(imagesTable).values({
        pageId: post.page.id,
        originalUrl: post.page.featuredImageUrl,
        url: post.page.featuredImageUrl,
        alt: post.page.featuredImageAlt ?? null,
        role: "featured",
        position: 0,
      });
    }

    // FAQ
    if (post.faq?.length) {
      await db.insert(faqTable).values(
        post.faq.map((f) => ({ pageId: post.page.id, ...f })),
      );
    }

    // JSON-LD
    if (post.jsonld?.length) {
      await db.insert(jsonldTable).values(
        post.jsonld.map((j, i) => ({
          pageId: post.page.id,
          type: j.type,
          data: j.data,
          position: i,
        })),
      );
    }

    // External links (no resolution required)
    if (post.externalLinks?.length) {
      await db.insert(externalLinksTable).values(
        post.externalLinks.map((l) => ({ pageId: post.page.id, ...l })),
      );
    }
  }

  // Internal links: insert after all pages exist so targets can be resolved.
  console.log("Inserting internal links with resolved targets...");
  const byCanonical = new Map(allPosts.map((p) => [p.page.canonicalUrl, p.page.id]));
  for (const post of allPosts) {
    if (!post.internalLinks?.length) continue;
    await db.insert(internalLinksTable).values(
      post.internalLinks.map((l) => ({
        pageId: post.page.id,
        targetPageId: byCanonical.get(l.href) ?? null,
        ...l,
      })),
    );
  }

  console.log("Inserting redirects...");
  await db.insert(redirectsTable).values(redirects);

  console.log(
    `Seed complete: ${authors.length} authors, ${categories.length} categories, ${tags.length} tags, ${allPosts.length} posts.`,
  );
}

seed()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await pool.end();
    process.exit(1);
  });
