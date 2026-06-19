import { describe, it, expect } from "vitest";
import {
  decodeEntities,
  slugify,
  titleCaseFromSlug,
  parseCategoryPath,
  cityFromSegment,
  cleanSegmentName,
  extractLeafCategory,
  allocateSlug,
  allocateSlugs,
  deriveCategoryGraph,
  type PostLeafInput,
} from "../index";

const CAT = "https://www.headout.com/blog/category";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("Festivals &amp; Celebrations")).toBe(
      "Festivals & Celebrations",
    );
    expect(decodeEntities("Tom&#8217;s Guide")).toBe("Tom\u2019s Guide");
    expect(decodeEntities("It&#039;s")).toBe("It's");
  });
  it("handles double-encoding and leaves plain text untouched", () => {
    expect(decodeEntities("A &amp;amp; B")).toBe("A & B");
    expect(decodeEntities("Plain Name")).toBe("Plain Name");
  });
});

describe("slugify", () => {
  it("maps & to 'and' and strips punctuation", () => {
    expect(slugify("Travel Tips &amp; Hacks")).toBe("travel-tips-and-hacks");
    expect(slugify("Things to do in New York")).toBe("things-to-do-in-new-york");
    expect(slugify("LGBTQIA+")).toBe("lgbtqia");
  });
  it("strips diacritics", () => {
    expect(slugify("Café Guide")).toBe("cafe-guide");
  });
});

describe("titleCaseFromSlug", () => {
  it("title-cases city slugs", () => {
    expect(titleCaseFromSlug("new-york")).toBe("New York");
    expect(titleCaseFromSlug("abu-dhabi")).toBe("Abu Dhabi");
    expect(titleCaseFromSlug("kuala-lumpur")).toBe("Kuala Lumpur");
  });
});

describe("parseCategoryPath", () => {
  it("returns segments after /blog/category/", () => {
    expect(
      parseCategoryPath(`${CAT}/things-to-do-city-london/wp-x/wcp-y/`),
    ).toEqual(["things-to-do-city-london", "wp-x", "wcp-y"]);
  });
  it("returns null for non-category urls", () => {
    expect(parseCategoryPath("https://www.headout.com/blog/some-article/")).toBeNull();
  });
});

describe("cityFromSegment", () => {
  it("extracts the city key", () => {
    expect(cityFromSegment("things-to-do-city-las-vegas")).toBe("las-vegas");
    expect(cityFromSegment("things-to-do-in-brisbane")).toBeNull();
    expect(cityFromSegment("wcp-travel")).toBeNull();
  });
});

describe("cleanSegmentName", () => {
  it("strips wcp-/wp- prefixes and id suffixes", () => {
    expect(cleanSegmentName("wcp-travel")).toBe("Travel");
    expect(cleanSegmentName("broadway-tickets-c-24")).toBe("Broadway Tickets");
    expect(cleanSegmentName("landmarks-rome-sc-1007__11738")).toBe(
      "Landmarks Rome",
    );
  });
});

describe("extractLeafCategory", () => {
  const itemList = (
    entries: [number, string, string][],
  ) =>
    entries.map(([position, name, id]) => ({
      "@type": "ListItem",
      position,
      item: { "@id": id, name },
    }));

  it("picks the deepest /blog/category/ item (3-level)", () => {
    const items = itemList([
      [1, "Headout Blog", "https://www.headout.com/blog/"],
      [2, "Festivals &amp; Celebrations in London", `${CAT}/things-to-do-city-london/wp-g/wcp-fest/`],
      [3, "Article", "https://www.headout.com/blog/valentines/"],
    ]);
    expect(extractLeafCategory(items)).toEqual({
      name: "Festivals & Celebrations in London",
      url: `${CAT}/things-to-do-city-london/wp-g/wcp-fest/`,
    });
  });

  it("picks the deepest of multiple category items (5-level)", () => {
    const items = itemList([
      [1, "Blog", "https://www.headout.com/blog/"],
      [2, "Travel", `${CAT}/wcp-travel/`],
      [3, "Travel Inspiration", `${CAT}/wcp-travel/wcp-travel-inspiration/`],
      [4, "Offbeat Travel", `${CAT}/wcp-travel/wcp-travel-inspiration/wcp-offbeat-travel/`],
      [5, "Some Post", "https://www.headout.com/blog/some-post/"],
    ]);
    expect(extractLeafCategory(items)?.url).toBe(
      `${CAT}/wcp-travel/wcp-travel-inspiration/wcp-offbeat-travel/`,
    );
  });

  it("returns null when there is no category level", () => {
    const items = itemList([
      [1, "Blog", "https://www.headout.com/blog/"],
      [2, "An Article", "https://www.headout.com/blog/an-article/"],
    ]);
    expect(extractLeafCategory(items)).toBeNull();
    expect(extractLeafCategory(null)).toBeNull();
  });
});

describe("allocateSlug / allocateSlugs", () => {
  it("suffixes on collision", () => {
    const taken = new Set<string>(["travel"]);
    expect(allocateSlug("travel", taken)).toBe("travel-2");
    expect(allocateSlug("travel", taken)).toBe("travel-3");
    expect(allocateSlug("paris", taken)).toBe("paris");
  });

  it("resolves a derived set against existing slugs deterministically", () => {
    const cats = [
      { originalUrl: "u1", name: "Travel", parentUrl: null, citySlug: null, desiredSlug: "travel", isTopLevel: true },
      { originalUrl: "u2", name: "Travel", parentUrl: null, citySlug: null, desiredSlug: "travel", isTopLevel: true },
    ];
    const map = allocateSlugs(cats, ["travel"]);
    expect(map.get("u1")).toBe("travel-2");
    expect(map.get("u2")).toBe("travel-3");
  });
});

describe("deriveCategoryGraph", () => {
  it("builds a city parent + leaf with dual links", () => {
    const posts: PostLeafInput[] = [
      {
        postId: "p1",
        leafName: "Festivals &amp; Celebrations in London",
        leafUrl: `${CAT}/things-to-do-city-london/wp-g/wcp-fest/`,
      },
    ];
    const { categories, assignments } = deriveCategoryGraph(posts);
    const parent = categories.find((c) => c.isTopLevel);
    const leaf = categories.find((c) => !c.isTopLevel);
    expect(parent).toMatchObject({
      name: "London",
      desiredSlug: "city-london",
      parentUrl: null,
      originalUrl: `${CAT}/things-to-do-city-london/`,
    });
    expect(leaf).toMatchObject({
      name: "Festivals & Celebrations in London",
      desiredSlug: "festivals-and-celebrations-in-london",
      parentUrl: `${CAT}/things-to-do-city-london/`,
    });
    expect(assignments[0]).toEqual({
      postId: "p1",
      primaryUrl: leaf!.originalUrl,
      linkUrls: [parent!.originalUrl, leaf!.originalUrl],
    });
  });

  it("treats a single-segment city as the top level itself (no leaf)", () => {
    const posts: PostLeafInput[] = [
      {
        postId: "p2",
        leafName: "Things to do in London",
        leafUrl: `${CAT}/things-to-do-city-london/`,
      },
    ];
    const { categories, assignments } = deriveCategoryGraph(posts);
    expect(categories).toHaveLength(1);
    expect(categories[0]).toMatchObject({ name: "London", desiredSlug: "city-london" });
    expect(assignments[0]).toEqual({
      postId: "p2",
      primaryUrl: `${CAT}/things-to-do-city-london/`,
      linkUrls: [`${CAT}/things-to-do-city-london/`],
    });
  });

  it("derives a topic parent name from the segment map", () => {
    const posts: PostLeafInput[] = [
      { postId: "a", leafName: "Travel", leafUrl: `${CAT}/wcp-travel/` },
      {
        postId: "b",
        leafName: "Offbeat Travel",
        leafUrl: `${CAT}/wcp-travel/wcp-travel-inspiration/wcp-offbeat-travel/`,
      },
    ];
    const { categories, assignments } = deriveCategoryGraph(posts);
    const travel = categories.find((c) => c.originalUrl === `${CAT}/wcp-travel/`);
    expect(travel).toMatchObject({ name: "Travel", desiredSlug: "travel", isTopLevel: true });
    // Offbeat Travel collapses to a child of Travel (middle tier dropped).
    const offbeat = categories.find((c) => c.name === "Offbeat Travel");
    expect(offbeat).toMatchObject({ parentUrl: `${CAT}/wcp-travel/`, isTopLevel: false });
    const bAssign = assignments.find((x) => x.postId === "b")!;
    expect(bAssign.linkUrls).toEqual([
      `${CAT}/wcp-travel/`,
      `${CAT}/wcp-travel/wcp-travel-inspiration/wcp-offbeat-travel/`,
    ]);
  });

  it("dedupes categories shared across posts", () => {
    const posts: PostLeafInput[] = [
      { postId: "p1", leafName: "Broadway", leafUrl: `${CAT}/things-to-do-city-new-york/broadway-tickets-c-24/` },
      { postId: "p2", leafName: "Broadway", leafUrl: `${CAT}/things-to-do-city-new-york/broadway-tickets-c-24/` },
    ];
    const { categories } = deriveCategoryGraph(posts);
    // one city parent + one leaf
    expect(categories).toHaveLength(2);
    expect(categories.filter((c) => c.isTopLevel)).toHaveLength(1);
  });
});
