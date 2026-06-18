import { Router, type IRouter, type Request } from "express";
import { buildSitemap, buildRssFeed } from "../lib/feeds";

/**
 * Discovery feeds for the public blog. These are served under `/blog/` (not
 * `/api`) so they share the blog's origin, and the proxy routes the exact
 * paths `/blog/sitemap.xml` and `/blog/feed.xml` to this service while the
 * static blog handles everything else under `/blog/`.
 */

const router: IRouter = Router();

/** Resolve the public origin (scheme + host, no trailing slash) from the request. */
function requestOrigin(req: Request): string {
  const proto =
    String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() ||
    req.protocol ||
    "https";
  const host =
    String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() ||
    req.headers.host ||
    "localhost";
  return `${proto}://${host}`;
}

router.get("/blog/sitemap.xml", async (req, res) => {
  const xml = await buildSitemap(requestOrigin(req));
  res.type("application/xml").send(xml);
});

router.get("/blog/feed.xml", async (req, res) => {
  const xml = await buildRssFeed(requestOrigin(req));
  res.type("application/rss+xml").send(xml);
});

export default router;
