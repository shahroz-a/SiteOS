import { describe, expect, it } from "vitest";
import { assemblePage } from "../assemble";
import { makeFetchResult } from "./helpers";
import type { RedirectHop } from "../types";

/**
 * The page's redirect chain is filtered upstream (at assemble time) to hops
 * whose OLD path (`from`) is a clean, blog-serveable URL, using the same shared
 * predicate as frontier expansion. Off-blog / malformed source-markup junk is
 * dropped here so it can never reach the redirect list at storage.
 */
describe("assemblePage redirect-chain filtering", () => {
  const ORIGIN = "https://www.headout.com";
  const URL = `${ORIGIN}/blog/some-article/`;
  const HTML = "<html><head><title>x</title></head><body><p>hi</p></body></html>";

  function assembleWith(hops: RedirectHop[]) {
    return assemblePage({ ...makeFetchResult(HTML, URL), redirectChain: hops }, null);
  }

  it("keeps clean on-blog hops and drops off-blog/malformed ones", () => {
    const page = assembleWith([
      { from: `${ORIGIN}/blog/old-name/`, to: `${ORIGIN}/blog/new-name/`, status: 301 },
      // off-blog `from` — the blog can't serve it
      {
        from: `${ORIGIN}/statue-of-liberty-cruises-c-121/`,
        to: `${ORIGIN}/statue-of-liberty-tickets-c-121/`,
        status: 301,
      },
      // embedded-URL junk `from`
      {
        from: `${ORIGIN}/blog/disneyland-paris-tips/https://www.headout.com/blog/disneyland-paris-hotel/`,
        to: `${ORIGIN}/blog/disneyland-paris-hotel/`,
        status: 301,
      },
      // trailing-quote junk `from`
      {
        from: `${ORIGIN}/blog/best-broadway-shows-january/%22`,
        to: `${ORIGIN}/blog/best-broadway-shows-january/`,
        status: 301,
      },
    ]);

    expect(page.redirectChain).toEqual([
      { from: `${ORIGIN}/blog/old-name/`, to: `${ORIGIN}/blog/new-name/`, status: 301 },
    ]);
  });

  it("keeps a hop whose `from` only needs accidental repeated slashes collapsed", () => {
    const page = assembleWith([
      {
        from: `${ORIGIN}/blog/acropolis-athens//tickets/`,
        to: `${ORIGIN}/blog/acropolis-athens-tickets/`,
        status: 301,
      },
    ]);

    expect(page.redirectChain).toHaveLength(1);
    expect(page.redirectChain[0]!.from).toBe(`${ORIGIN}/blog/acropolis-athens//tickets/`);
  });

  it("drops hops whose DESTINATION is junk while keeping clean on-blog and off-blog targets", () => {
    const page = assembleWith([
      // clean on-blog destination — kept
      { from: `${ORIGIN}/blog/old-a/`, to: `${ORIGIN}/blog/new-a/`, status: 301 },
      // legitimate off-blog destination on the Headout origin — kept
      {
        from: `${ORIGIN}/blog/retired-piece/`,
        to: `${ORIGIN}/empire-state-building-tickets-c-234/`,
        status: 301,
      },
      // foreign-host destination (map link) — dropped (would be re-hosted on headout.com)
      {
        from: `${ORIGIN}/blog/where-to-eat/`,
        to: "https://maps.google.com/?q=rome",
        status: 301,
      },
      // embedded-URL junk destination — dropped
      {
        from: `${ORIGIN}/blog/disneyland-tips/`,
        to: `${ORIGIN}/blog/foo/https://www.headout.com/blog/bar/`,
        status: 301,
      },
      // bare-domain segment destination — dropped
      {
        from: `${ORIGIN}/blog/athens-guide/`,
        to: `${ORIGIN}/introducingathens.com`,
        status: 301,
      },
    ]);

    expect(page.redirectChain).toEqual([
      { from: `${ORIGIN}/blog/old-a/`, to: `${ORIGIN}/blog/new-a/`, status: 301 },
      {
        from: `${ORIGIN}/blog/retired-piece/`,
        to: `${ORIGIN}/empire-state-building-tickets-c-234/`,
        status: 301,
      },
    ]);
  });
});
