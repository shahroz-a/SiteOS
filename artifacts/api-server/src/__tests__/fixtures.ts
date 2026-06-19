/**
 * Deterministic seed data for the read-API tests. Ids are real UUIDs because the
 * response zod schemas validate `id` fields with `.uuid()`.
 */
import type { Tables } from "./fakeDb";

export const IDS = {
  alice: "11111111-1111-4111-8111-111111111111",
  bob: "22222222-2222-4222-8222-222222222222",
  travel: "33333333-3333-4333-8333-333333333333",
  food: "44444444-4444-4444-8444-444444444444",
  cityLondon: "31313131-3131-4131-8131-313131313131",
  theatresLondon: "32323232-3232-4232-8232-323232323232",
  events: "39393939-3939-4939-8939-393939393939",
  tagFamily: "55555555-5555-4555-8555-555555555555",
  tagThanksgiving: "66666666-6666-4666-8666-666666666666",
  tagBudget: "77777777-7777-4777-8777-777777777777",
  p1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  p2: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  p3: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  p4: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  p5: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  draft: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  staticPage: "12121212-1212-4121-8121-121212121212",
  faq1: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  img1: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
} as const;

function makePage(over: Record<string, unknown>): Record<string, unknown> {
  return {
    subtitle: null,
    excerpt: null,
    canonicalUrl: "https://example.com/blog/post",
    pathname: "/blog/post",
    parentPath: null,
    featuredImageUrl: null,
    featuredImageAlt: null,
    readingTimeMinutes: 5,
    wordCount: 800,
    language: "en",
    publishedAt: null,
    modifiedAt: null,
    cleanedHtml: "<p>content</p>",
    richText: null,
    componentTree: null,
    authorId: null,
    primaryCategoryId: null,
    status: "published",
    pageType: "post",
    createdAt: new Date("2025-10-01T00:00:00Z"),
    ...over,
  };
}

export function seedTables(): Tables {
  return {
    authors: [
      {
        id: IDS.alice,
        name: "Alice Walker",
        slug: "alice-walker",
        bio: "Travel editor.",
        avatarUrl: "https://example.com/alice.jpg",
        role: "Editor",
        email: "alice@example.com",
        originalUrl: "https://example.com/authors/alice",
        social: { twitter: "@alice" },
      },
      {
        id: IDS.bob,
        name: "Bob Stevens",
        slug: "bob-stevens",
        bio: null,
        avatarUrl: null,
        role: null,
        email: null,
        originalUrl: null,
        social: null,
      },
    ],
    categories: [
      {
        id: IDS.travel,
        name: "Travel",
        slug: "travel",
        description: "Trips and destinations.",
        parentId: null,
        path: "/travel",
      },
      {
        id: IDS.food,
        name: "Food",
        slug: "food",
        description: null,
        parentId: null,
        path: "/food",
      },
      {
        id: IDS.cityLondon,
        name: "London",
        slug: "city-london",
        description: null,
        parentId: null,
        path: "city-london",
      },
      {
        id: IDS.theatresLondon,
        name: "Theatres in London",
        slug: "theatres-in-london",
        description: null,
        parentId: IDS.cityLondon,
        path: "city-london/theatres-in-london",
      },
      // Scraped "junk" category: present in the table but links to no published
      // post, so it must never appear in GET /categories.
      {
        id: IDS.events,
        name: "Events",
        slug: "events",
        description: null,
        parentId: null,
        path: "/events",
      },
    ],
    tags: [
      { id: IDS.tagFamily, name: "Family", slug: "family" },
      { id: IDS.tagThanksgiving, name: "Thanksgiving", slug: "thanksgiving" },
      { id: IDS.tagBudget, name: "Budget", slug: "budget" },
    ],
    pages: [
      makePage({
        id: IDS.p1,
        slug: "boston-for-families",
        title: "Boston for Families",
        excerpt: "A family guide to Boston.",
        cleanedHtml: "<p>Enjoy turkey and history in Boston.</p>",
        authorId: IDS.alice,
        primaryCategoryId: IDS.travel,
        publishedAt: new Date("2025-11-01T00:00:00Z"),
        canonicalUrl: "https://example.com/blog/boston-for-families",
        pathname: "/blog/boston-for-families",
      }),
      makePage({
        id: IDS.p2,
        slug: "budget-nyc",
        title: "Budget NYC Trip",
        excerpt: "See NYC on a budget.",
        cleanedHtml: "<p>Cheap eats in the city.</p>",
        authorId: IDS.bob,
        primaryCategoryId: IDS.travel,
        publishedAt: new Date("2025-11-05T00:00:00Z"),
      }),
      makePage({
        id: IDS.p3,
        slug: "thanksgiving-recipes",
        title: "Thanksgiving Recipes",
        excerpt: "Classic holiday dishes.",
        cleanedHtml: "<p>How to roast a turkey.</p>",
        authorId: IDS.alice,
        primaryCategoryId: IDS.food,
        publishedAt: new Date("2025-11-10T00:00:00Z"),
      }),
      makePage({
        id: IDS.p4,
        slug: "chicago-eats",
        title: "Chicago Eats",
        excerpt: "Deep dish and more.",
        cleanedHtml: "<p>Best restaurants in Chicago.</p>",
        authorId: IDS.bob,
        primaryCategoryId: IDS.food,
        publishedAt: new Date("2025-11-15T00:00:00Z"),
      }),
      makePage({
        id: IDS.p5,
        slug: "seattle-getaway",
        title: "Seattle Getaway",
        excerpt: "Rainy day fun.",
        cleanedHtml: "<p>Coffee and culture.</p>",
        authorId: IDS.alice,
        primaryCategoryId: IDS.travel,
        publishedAt: null,
      }),
      makePage({
        id: IDS.draft,
        slug: "draft-post",
        title: "Draft Post",
        status: "draft",
        authorId: IDS.alice,
        primaryCategoryId: IDS.travel,
        publishedAt: new Date("2025-11-20T00:00:00Z"),
      }),
      makePage({
        id: IDS.staticPage,
        slug: "about",
        title: "About Us",
        pageType: "page",
        publishedAt: new Date("2025-09-01T00:00:00Z"),
      }),
    ],
    page_categories: [
      // Every post is linked in page_categories to its category/categories, as
      // the backfill guarantees (primary leaf + any parents/extra categories).
      // P1 linked to its own primary category (dedup must not double-count it).
      { pageId: IDS.p1, categoryId: IDS.travel },
      { pageId: IDS.p2, categoryId: IDS.travel },
      { pageId: IDS.p3, categoryId: IDS.food },
      { pageId: IDS.p4, categoryId: IDS.food },
      // P4's primary is Food, but it is also linked to Travel via M2M.
      { pageId: IDS.p4, categoryId: IDS.travel },
      // P5 is published (status), so it counts even with a null publishedAt.
      { pageId: IDS.p5, categoryId: IDS.travel },
      // London city parent + its leaf both link the same posts, so the parent
      // page resolves descendant posts (the two-level taxonomy invariant).
      { pageId: IDS.p1, categoryId: IDS.cityLondon },
      { pageId: IDS.p1, categoryId: IDS.theatresLondon },
      { pageId: IDS.p2, categoryId: IDS.cityLondon },
      { pageId: IDS.p2, categoryId: IDS.theatresLondon },
    ],
    page_tags: [
      { pageId: IDS.p1, tagId: IDS.tagFamily },
      { pageId: IDS.p1, tagId: IDS.tagThanksgiving },
      { pageId: IDS.p2, tagId: IDS.tagBudget },
      { pageId: IDS.p3, tagId: IDS.tagThanksgiving },
      { pageId: IDS.p3, tagId: IDS.tagFamily },
    ],
    breadcrumbs: [
      { pageId: IDS.p1, label: "Home", url: "/", position: 0 },
      { pageId: IDS.p1, label: "Boston", url: "/blog/boston-for-families", position: 1 },
    ],
    faq: [
      {
        pageId: IDS.p1,
        id: IDS.faq1,
        question: "Is Boston family friendly?",
        answer: "Yes, very.",
        position: 0,
      },
    ],
    images: [
      {
        pageId: IDS.p1,
        id: IDS.img1,
        url: "https://example.com/boston.jpg",
        originalUrl: "https://example.com/boston-orig.jpg",
        alt: "Boston skyline",
        caption: null,
        credit: null,
        width: 1200,
        height: 800,
        role: "featured",
        position: 0,
      },
    ],
    jsonld: [
      {
        pageId: IDS.p1,
        type: "Article",
        data: { headline: "Boston for Families" },
        position: 0,
      },
    ],
    seo: [
      {
        pageId: IDS.p1,
        metaTitle: "Boston for Families",
        metaDescription: "A family guide to Boston.",
        canonicalUrl: "https://example.com/blog/boston-for-families",
        robots: "index, follow",
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        twitterCard: null,
        twitterTitle: null,
        twitterDescription: null,
        twitterImage: null,
        keywords: ["boston", "family"],
      },
    ],
  };
}
