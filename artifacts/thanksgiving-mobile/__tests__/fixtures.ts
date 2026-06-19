import type { PostDetail, PostSummary } from "@workspace/api-client-react";

export function makePost(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "thanksgiving-family-trips",
    title: "Thanksgiving Family Trips",
    subtitle: null,
    excerpt: "The best places to take the family this Thanksgiving.",
    canonicalUrl: "https://www.headout.com/blog/thanksgiving-family-trips/",
    pathname: "/blog/thanksgiving-family-trips/",
    featuredImageUrl: null,
    featuredImageAlt: null,
    readingTimeMinutes: 6,
    publishedAt: "2025-11-01T00:00:00.000Z",
    author: { id: "a1", name: "Jane Doe", slug: "jane-doe" },
    primaryCategory: { id: "c1", name: "Travel", slug: "travel" },
    tags: [],
    ...overrides,
  };
}

export function makePostDetail(
  overrides: Partial<PostDetail> = {},
): PostDetail {
  const summary = makePost();
  return {
    ...summary,
    parentPath: null,
    wordCount: 1200,
    language: "en",
    modifiedAt: null,
    contentHtml: "<p>Body</p>",
    richText: null,
    componentTree: null,
    categories: summary.primaryCategory ? [summary.primaryCategory] : [],
    breadcrumbs: [],
    faq: [],
    images: [],
    seo: null,
    jsonld: [],
    ...overrides,
  };
}
